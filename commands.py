"""``hermes activity`` CLI command and ``/activity`` slash command.

The desktop half calls ``hermes --profile <p> activity summary --json`` through the
gateway's ``cli.exec`` RPC, so every call runs in a
fresh process against the right profile and no gateway restart is ever needed.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from . import activity_data as data

HELP = """Usage: /activity [days]
Shows token and session totals for the last N days (default 30).
Open the Activity page in Hermes Desktop for the full contribution grid."""

# The provider-history collector is a Node/TypeScript adapter (its provider
# source adapters are TypeScript). Give a live fetch more room than a cache read.
_REFRESH_TIMEOUT_S = 60
_CACHED_TIMEOUT_S = 20


def _fmt(n: float) -> str:
    for size, suffix in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if n >= size:
            return f"{n / size:.1f}{suffix}"
    return str(int(n))


def render_text(days: int = 30) -> str:
    s = data.summary(days=days)
    t = s["totals"]
    total = sum(t[k] for k in ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "reasoning_tokens"))
    lines = [
        f"Activity, last {days} days ({s['range']['start']} to {s['range']['end']})",
        f"  Sessions:  {t['sessions']}  (+{t['subagent_sessions']} subagent)",
        f"  Tokens:    {_fmt(total)} total",
        f"             {_fmt(t['input_tokens'])} input, {_fmt(t['output_tokens'])} output, "
        f"{_fmt(t['cache_read_tokens'])} cache read, {_fmt(t['reasoning_tokens'])} reasoning",
        f"  Active days: {sum(1 for d in s['daily'] if d['sessions'] or d['subagent_sessions'])}",
    ]
    if s["models"]:
        m = s["models"][0]
        lines.append(f"  Top model: {m['model']}" + (f" ({m['provider']})" if m.get("provider") else ""))
    return "\n".join(lines)


# -- slash command ----------------------------------------------------------------


def slash_command(raw_args: str) -> str:
    raw = (raw_args or "").strip()
    if raw in ("help", "-h", "--help", "?"):
        return HELP
    try:
        days = int(raw) if raw else 30
    except ValueError:
        return HELP
    try:
        return render_text(max(1, min(days, data.MAX_DAYS)))
    except data.ActivityError as exc:
        return f"activity: {exc}"


# -- CLI command ------------------------------------------------------------------


def _add_history_args(p) -> None:
    p.add_argument("--days", type=int, default=365, help="Last 1-365 local days")
    p.add_argument("--provider", default="all", help="Provider id or 'all'")
    p.add_argument("--desktop", action="store_true", help="Return compact daily rows for the desktop page")
    p.add_argument("--json", action="store_true", help="Emit structured provider history")
    p.add_argument("--refresh", action="store_true", help="Fetch provider-reported usage and update the local archive")


# -- provider-history (shared by the 'provider-history' command and its 'history' alias) --


def setup_argparse(subparser) -> None:
    subs = subparser.add_subparsers(dest="activity_command")
    p = subs.add_parser("summary", help="Usage aggregates for a range (default: last 365 days)")
    p.add_argument("--days", type=int, default=None, help=f"Last N days (1-{data.MAX_DAYS})")
    p.add_argument("--year", type=int, default=None, help="A calendar year, e.g. 2026 (overrides --days)")
    p.add_argument("--lite", action="store_true", help="Totals only (cheap; used by the status bar)")
    p.add_argument("--desktop", action="store_true", help="Trim breakdowns to the rows rendered by the desktop page")
    p.add_argument("--json", action="store_true", help="Emit JSON for the desktop page")
    _add_history_args(subs.add_parser("provider-history", help="Provider-reported usage history (own cache; 'history' is an alias)"))
    _add_history_args(subs.add_parser("history", help="Alias for provider-history"))
    d = subs.add_parser("day", help="Sessions that started on one local day")
    d.add_argument("date", help="YYYY-MM-DD")
    d.add_argument("--json", action="store_true", help="Emit JSON")
    subparser.set_defaults(func=handle_cli)


def _emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, separators=(",", ":"), default=str) + "\n")


# -- provider history (Node collector) --------------------------------------------


def _hermes_home() -> str:
    try:
        from hermes_constants import get_hermes_home

        return str(get_hermes_home())
    except Exception:
        return os.environ.get("HERMES_HOME") or str(Path.home() / ".hermes")


def collect_provider_history(*, days: int, provider: str = "all", refresh: bool = False, desktop: bool = False) -> dict:
    """Run the TypeScript provider-history collector and return its payload.

    The collector resolves the profile through ``HERMES_HOME`` (passed through
    explicitly) and reads saved account credentials from that home; credentials
    are never echoed back. On any failure a structured error is returned instead
    of raising, so the CLI can still emit valid JSON.
    """
    script = Path(__file__).resolve().parent / "scripts" / "provider-history.ts"
    node = shutil.which("node")
    if node is None:
        return {"error": "node runtime not found on PATH (provider-history needs node)", "overview": []}
    if not script.exists():
        return {"error": "provider-history collector script is missing", "overview": []}
    command = [node, str(script), "--days", str(days), "--provider", str(provider)]
    if desktop:
        command.append("--desktop")
    if refresh:
        command.append("--refresh")
    env = dict(os.environ)
    env["HERMES_HOME"] = _hermes_home()
    try:
        completed = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=_REFRESH_TIMEOUT_S if refresh else _CACHED_TIMEOUT_S,
            env=env,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"error": f"provider history collector unavailable ({type(exc).__name__})", "overview": []}
    if completed.returncode != 0:
        return {"error": "provider history collector failed", "overview": []}
    try:
        result = json.loads(completed.stdout)
    except (json.JSONDecodeError, TypeError):
        return {"error": "provider history collector returned invalid JSON", "overview": []}
    if not isinstance(result, dict) or not isinstance(result.get("overview"), list):
        return {"error": "provider history collector returned invalid data", "overview": []}
    return result


def _handle_provider_history(args, as_json: bool) -> None:
    result = collect_provider_history(
        days=max(1, min(int(getattr(args, "days", 365) or 365), 365)),
        provider=getattr(args, "provider", "all") or "all",
        refresh=bool(getattr(args, "refresh", False)),
        desktop=bool(getattr(args, "desktop", False)),
    )
    if as_json:
        return _emit(result)
    if result.get("error"):
        print(f"activity provider-history: {result['error']}", file=sys.stderr)
        sys.exit(1)
    rng = result.get("range") or {}
    overview = result.get("overview") or []
    backed = sum(1 for row in overview if isinstance(row, dict) and row.get("status") in ("available", "summary-only"))
    print(f"Provider history: {len(overview)} provider(s), {backed} with data, {rng.get('start')} to {rng.get('end')}")


def handle_cli(args) -> None:
    cmd = getattr(args, "activity_command", None) or "summary"
    as_json = bool(getattr(args, "json", False))
    if cmd in ("provider-history", "history"):
        return _handle_provider_history(args, as_json)
    try:
        if cmd == "day":
            payload = data.day(args.date)
            if as_json:
                return _emit(payload)
            for s in payload["sessions"]:
                print(f"{s['id']}  {_fmt(s['tokens']):>7}  {s['messages']:>4} msgs  {s.get('title') or ''}")
            return
        days, year = getattr(args, "days", None), getattr(args, "year", None)
        if as_json:
            return _emit(
                data.summary(
                    days=days,
                    year=year,
                    lite=bool(getattr(args, "lite", False)),
                    desktop=bool(getattr(args, "desktop", False)),
                )
            )
        print(render_text(days or 30))
    except data.ActivityError as exc:
        if as_json:
            return _emit({"error": str(exc), "plugin_version": data.PLUGIN_VERSION})
        print(f"activity: {exc}", file=sys.stderr)
        sys.exit(1)
