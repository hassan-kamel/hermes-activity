"""``hermes activity`` CLI command and ``/activity`` slash command.

The desktop half calls ``hermes --profile <p> activity summary --json`` through the
gateway's ``cli.exec`` RPC, so every call runs in a
fresh process against the right profile and no gateway restart is ever needed.
"""

from __future__ import annotations

import json
import sys

from . import activity_data as data

HELP = """Usage: /activity [days]
Shows token and session totals for the last N days (default 30).
Open the Activity page in Hermes Desktop for the full contribution grid."""


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


def setup_argparse(subparser) -> None:
    subs = subparser.add_subparsers(dest="activity_command")
    p = subs.add_parser("summary", help="Usage aggregates for a range (default: last 365 days)")
    p.add_argument("--days", type=int, default=None, help=f"Last N days (1-{data.MAX_DAYS})")
    p.add_argument("--year", type=int, default=None, help="A calendar year, e.g. 2026 (overrides --days)")
    p.add_argument("--lite", action="store_true", help="Totals only (cheap; used by the status bar)")
    p.add_argument("--desktop", action="store_true", help="Trim breakdowns to the rows rendered by the desktop page")
    p.add_argument("--json", action="store_true", help="Emit JSON for the desktop page")
    d = subs.add_parser("day", help="Sessions that started on one local day")
    d.add_argument("date", help="YYYY-MM-DD")
    d.add_argument("--json", action="store_true", help="Emit JSON")
    subparser.set_defaults(func=handle_cli)


def _emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, separators=(",", ":"), default=str) + "\n")


def handle_cli(args) -> None:
    cmd = getattr(args, "activity_command", None) or "summary"
    as_json = bool(getattr(args, "json", False))
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
