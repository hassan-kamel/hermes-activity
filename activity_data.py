"""hermes-activity data layer: read-only usage aggregates over the profile's ``state.db``.

* The database is opened with SQLite's ``mode=ro`` URI, so this module can never write.
* The profile is chosen by the caller's Hermes home (``hermes --profile X activity ...``),
  resolved through ``hermes_constants.get_hermes_home()``.
* Days are bucketed by session start in local time, the same rule ``hermes insights``
  and the dashboard analytics page use.
* Tool and skill breakdowns come from core ``agent.insights.InsightsEngine``; if that
  import ever moves, the payload still builds and those two lists come back empty.
"""

from __future__ import annotations

import sqlite3
import time
from contextlib import closing
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Optional

PLUGIN_VERSION = "0.2.2"
MAX_DAYS = 731  # two years: enough for the year tabs, bounded so a query stays cheap


class ActivityError(Exception):
    """User-facing failure (missing store, bad argument)."""


# --------------------------------------------------------------------------- db access


def db_path() -> Path:
    from hermes_constants import get_hermes_home

    return Path(get_hermes_home()) / "state.db"


def _connect() -> sqlite3.Connection:
    path = db_path()
    if not path.exists():
        raise ActivityError("no session store yet (state.db missing)")
    conn = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True, timeout=5)
    conn.row_factory = sqlite3.Row
    return conn


def _rows(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def _columns(conn: sqlite3.Connection) -> set[str]:
    return {r[1] for r in conn.execute("PRAGMA table_info(sessions)").fetchall()}


# --------------------------------------------------------------------------- range


def _local_midnight(d: date) -> float:
    return datetime(d.year, d.month, d.day).timestamp()


def resolve_range(days: Optional[int], year: Optional[int]) -> tuple[float, float, str, str]:
    """(start_ts, end_ts, start_day, end_day). ``year`` wins over ``days``."""
    today = date.today()
    if year:
        start, end = date(year, 1, 1), min(date(year, 12, 31), today)
        if start > today:
            raise ActivityError("year is in the future")
    else:
        n = max(1, min(int(days or 365), MAX_DAYS))
        start, end = today - timedelta(days=n - 1), today
    return _local_midnight(start), _local_midnight(end + timedelta(days=1)), start.isoformat(), end.isoformat()


# --------------------------------------------------------------------------- queries

# Shared SUM block. ``cost`` prefers the provider-reported actual cost over the estimate.
_SUMS = """
    COALESCE(SUM(input_tokens), 0)       AS input_tokens,
    COALESCE(SUM(output_tokens), 0)      AS output_tokens,
    COALESCE(SUM(cache_read_tokens), 0)  AS cache_read_tokens,
    COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
    COALESCE(SUM(reasoning_tokens), 0)   AS reasoning_tokens,
    COALESCE(SUM(message_count), 0)      AS messages,
    COALESCE(SUM(tool_call_count), 0)    AS tool_calls,
    {api_calls}                          AS api_calls,
    COALESCE(SUM(CASE WHEN parent_session_id IS NULL THEN 1 ELSE 0 END), 0)     AS sessions,
    COALESCE(SUM(CASE WHEN parent_session_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS subagent_sessions,
    COALESCE(SUM(COALESCE(actual_cost_usd, estimated_cost_usd)), 0) AS cost_usd,
    COALESCE(SUM(CASE WHEN COALESCE(actual_cost_usd, estimated_cost_usd) > 0 THEN 1 ELSE 0 END), 0) AS priced_sessions,
    COALESCE(SUM(CASE WHEN billing_mode = 'subscription' THEN 1 ELSE 0 END), 0) AS subscription_sessions
"""

_TOKENS = (
    "(COALESCE(input_tokens,0)+COALESCE(output_tokens,0)+COALESCE(cache_read_tokens,0)"
    "+COALESCE(cache_write_tokens,0)+COALESCE(reasoning_tokens,0))"
)
_DAY = "date(started_at, 'unixepoch', 'localtime')"
_WHERE = "WHERE started_at >= ? AND started_at < ?"

_SESSION_FIELDS = f"""id, title, source, model, billing_provider AS provider, started_at,
    COALESCE(message_count, 0) AS messages, COALESCE(tool_call_count, 0) AS tool_calls,
    COALESCE(input_tokens, 0) AS input_tokens, COALESCE(output_tokens, 0) AS output_tokens,
    COALESCE(cache_read_tokens, 0) AS cache_read_tokens, COALESCE(cache_write_tokens, 0) AS cache_write_tokens,
    COALESCE(reasoning_tokens, 0) AS reasoning_tokens, {_TOKENS} AS tokens,
    COALESCE(actual_cost_usd, estimated_cost_usd) AS cost_usd, parent_session_id"""


def _sums(cols: set[str]) -> str:
    api = "COALESCE(SUM(api_call_count), 0)" if "api_call_count" in cols else "0"
    return _SUMS.format(api_calls=api)


def _envelope(start_day: str, end_day: str, days, year) -> dict[str, Any]:
    return {
        "plugin_version": PLUGIN_VERSION,
        "generated_at": time.time(),
        "range": {"start": start_day, "end": end_day, "days": days, "year": year},
    }


# --------------------------------------------------------------------------- provider identity

def _endpoint_provider_maps() -> tuple[dict, dict]:
    """``(exact-host -> provider, registrable-domain -> provider)`` from the profile's configured
    provider endpoints. The config is the record of who serves traffic today; a session row's
    ``billing_base_url`` names the endpoint that answered it, so a provider name recorded under an
    older config alias (``litellm``, ``custom``) resolves to the provider that owns that endpoint
    now — one row per gateway, retired names gone."""
    try:
        from hermes_cli.config import cfg_get, load_config_readonly

        rows = cfg_get(load_config_readonly(), "providers", default=None)
    except Exception:
        return {}, {}
    host_map: dict[str, str] = {}
    domain_map: dict[str, str] = {}
    for name, row in (rows or {}).items():
        base = str((row or {}).get("base_url") or "").strip()
        if not base:
            continue
        try:
            from utils import base_url_hostname

            host = base_url_hostname(base)
        except Exception:
            continue
        if not host:
            continue
        host_map[host] = name
        parts = host.split(".")
        if len(parts) >= 2:
            domain_map.setdefault(".".join(parts[-2:]), name)
    return host_map, domain_map


def canonical_provider(provider: str, base_url: str) -> str:
    """The provider that serves traffic today for a recorded session row. Endpoint-identified
    first (the gateway that answered), then the recorded name (``agy://local`` and other
    non-HTTP routes keep theirs)."""
    host_map, domain_map = _endpoint_provider_maps()
    if not base_url:
        return provider
    try:
        from utils import base_url_hostname

        host = base_url_hostname(base_url)
    except Exception:
        return provider
    if not host:
        return provider
    return host_map.get(host) or domain_map.get(".".join(host.split(".")[-2:])) or provider


def _merge_provider_rows(rows: list[dict]) -> list[dict]:
    """Group raw (model, recorded provider, endpoint) rows by the canonical provider, summing
    the aggregate fields. Rows that served no API call (cron/no-agent sessions) carry no
    traffic, so they are not provider rows and are dropped from this view."""
    merged: dict[tuple[str, str], dict] = {}
    for row in rows:
        if not row.get("api_calls"):
            continue
        key = (row["model"], canonical_provider(row.get("provider") or "", row.get("base_url") or ""))
        target = merged.get(key)
        if target is None:
            target = {k: (0 if isinstance(v, (int, float)) and k not in ("last_used_at",) else v)
                      for k, v in row.items() if k not in ("base_url", "provider")}
            target["provider"] = key[1]
            merged[key] = target
        for k, v in row.items():
            if k in ("model", "provider", "base_url"):
                continue
            if k == "last_used_at":
                target[k] = max(target.get(k) or 0, v or 0)
            else:
                target[k] = (target.get(k) or 0) + (v or 0)
    out = sorted(merged.values(), key=lambda m: -(
        (m.get("input_tokens") or 0) + (m.get("output_tokens") or 0)
        + (m.get("cache_read_tokens") or 0) + (m.get("cache_write_tokens") or 0)
        + (m.get("reasoning_tokens") or 0)))
    return out


def summary(
    days: Optional[int] = None,
    year: Optional[int] = None,
    lite: bool = False,
    desktop: bool = False,
) -> dict[str, Any]:
    start_ts, end_ts, start_day, end_day = resolve_range(days, year)
    rng = (start_ts, end_ts)
    out = _envelope(start_day, end_day, days, year)
    with closing(_connect()) as conn:
        sums = _sums(_columns(conn))
        out["totals"] = _rows(conn, f"SELECT {sums} FROM sessions {_WHERE}", rng)[0]
        if lite:  # status-bar chip: totals only
            return out

        out["daily"] = _rows(conn, f"SELECT {_DAY} AS day, {sums} FROM sessions {_WHERE} GROUP BY day ORDER BY day", rng)
        raw = _rows(
            conn,
            f"""SELECT COALESCE(model, 'unknown') AS model, COALESCE(billing_provider, '') AS provider,
                       COALESCE(billing_base_url, '') AS base_url, {sums},
                       MAX(started_at) AS last_used_at
                FROM sessions {_WHERE}
                GROUP BY 1, 2, 3""",
            rng,
        )
        out["models"] = _merge_provider_rows(raw)
        out["sources"] = _rows(
            conn,
            f"""SELECT COALESCE(source, 'unknown') AS source, COUNT(*) AS sessions,
                       COALESCE(SUM({_TOKENS}), 0) AS tokens
                FROM sessions {_WHERE} GROUP BY source ORDER BY sessions DESC""",
            rng,
        )
        # weekday 0 = Sunday (SQLite %w), hour 0-23, local time
        out["punchcard"] = _rows(
            conn,
            f"""SELECT CAST(strftime('%w', started_at, 'unixepoch', 'localtime') AS INTEGER) AS weekday,
                       CAST(strftime('%H', started_at, 'unixepoch', 'localtime') AS INTEGER) AS hour,
                       COUNT(*) AS sessions, COALESCE(SUM({_TOKENS}), 0) AS tokens
                FROM sessions {_WHERE} GROUP BY weekday, hour""",
            rng,
        )
        notable = {}
        for key, order in (
            ("most_tokens", _TOKENS),
            ("most_messages", "COALESCE(message_count, 0)"),
            ("most_tool_calls", "COALESCE(tool_call_count, 0)"),
            ("most_expensive", "COALESCE(actual_cost_usd, estimated_cost_usd, 0)"),
        ):
            row = _rows(
                conn,
                f"SELECT {_SESSION_FIELDS} FROM sessions {_WHERE} AND {order} > 0 ORDER BY {order} DESC LIMIT 1",
                rng,
            )
            if row:
                notable[key] = row[0]
        out["notable"] = notable
        first = conn.execute("SELECT MIN(started_at) FROM sessions").fetchone()[0]
        out["first_activity_day"] = date.fromtimestamp(first).isoformat() if first else None

    out["tools"], out["skills"] = _usage_breakdown(start_ts)
    if desktop:
        out["models"] = out["models"][:8]
        out["tools"] = out["tools"][:8]
        out["skills"] = {"top_skills": (out["skills"].get("top_skills") or [])[:8]}
    return out


def _usage_breakdown(start_ts: float) -> tuple[list, dict]:
    """Tool + skill counts from core InsightsEngine (best effort; empty on any failure)."""
    try:
        from agent.insights import InsightsEngine
        from hermes_state import SessionDB

        span_days = max(1, int((time.time() - start_ts) // 86400) + 1)
        db = SessionDB(db_path=db_path(), read_only=True)
        try:
            usage = InsightsEngine(db).get_usage_breakdown(days=span_days)
        finally:
            db.close()
        return usage.get("tools") or [], usage.get("skills") or {}
    except Exception:
        return [], {}


def day(day_iso: str) -> dict[str, Any]:
    try:
        d = date.fromisoformat(day_iso)
    except ValueError as exc:
        raise ActivityError("day must be YYYY-MM-DD") from exc
    rng = (_local_midnight(d), _local_midnight(d + timedelta(days=1)))
    with closing(_connect()) as conn:
        sessions = _rows(conn, f"SELECT {_SESSION_FIELDS} FROM sessions {_WHERE} ORDER BY started_at", rng)
    return {"plugin_version": PLUGIN_VERSION, "day": day_iso, "sessions": sessions}