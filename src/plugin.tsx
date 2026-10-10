/**
 * hermes-activity — desktop half.
 *
 * GENERATED FILE NOTICE: desktop/plugin.js is compiled from src/plugin.tsx by `npm run build`.
 * Edit the .tsx, never the .js.
 *
 * Surfaces
 *   - Route page `/activity` (sidebar nav row + ⌘K "Open Activity")
 *   - Status bar chip: today's tokens; click opens the page
 *
 * Data path
 *   host.requestProfile(route, "cli.exec", { argv: ["--profile", p, "activity", "summary", "--json", ...] })
 *   -> the focused profile's Hermes CLI -> read-only SQL over state.db.
 *   Each call is a fresh process, so the plugin works without a gateway restart.
 *
 * Look & feel: mirrors the built-in Command Center "Usage" panel (flat sections, small
 * uppercase labels, theme variables only). No hard-coded colours anywhere, so it follows
 * every skin.
 */

import {
  Codicon,
  host,
  PALETTE_AREA,
  ROUTES_AREA,
  SegmentedControl,
  SIDEBAR_NAV_AREA,
  Skeleton,
  STATUSBAR_AREAS,
  useQuery,
  useQueryClient,
  useValue,
  type FocusedSessionOwner,
  type PluginContext,
  type ProfileRoute,
} from "@hermes/plugin-sdk";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

const ID = "hermes-activity";
const ROUTE = "/activity";
const WIDGET_VERSION = "0.1.0"; // must equal plugin.yaml `version`
const CLI_TIMEOUT_MS = 60_000;

// ───────────────────────────────────────────────────────────── types (CLI payload)

interface Sums {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  messages: number;
  tool_calls: number;
  api_calls: number;
  sessions: number;
  subagent_sessions: number;
  cost_usd: number;
  priced_sessions: number;
  subscription_sessions: number;
}
interface DailyRow extends Sums {
  day: string;
}
interface ModelRow extends Sums {
  model: string;
  provider: string | null;
  last_used_at: number;
}
interface SessionRow {
  id: string;
  title: string | null;
  source: string;
  model: string | null;
  provider: string | null;
  started_at: number;
  messages: number;
  tool_calls: number;
  tokens: number;
  cost_usd: number | null;
  parent_session_id: string | null;
}
interface Summary {
  plugin_version: string;
  range: { start: string; end: string; days: number | null; year: number | null };
  first_activity_day: string | null;
  totals: Sums;
  daily: DailyRow[];
  models: ModelRow[];
  sources: { source: string; sessions: number; tokens: number }[];
  punchcard: { weekday: number; hour: number; sessions: number; tokens: number }[];
  notable: Partial<Record<"most_tokens" | "most_messages" | "most_tool_calls" | "most_expensive", SessionRow>>;
  tools: { tool: string; count: number; percentage: number }[];
  skills: { top_skills?: { skill: string; total_count: number }[] };
}
interface Lite {
  plugin_version: string;
  totals: Sums;
}
interface DayPayload {
  day: string;
  sessions: SessionRow[];
}

type Metric = "tokens" | "sessions" | "messages" | "tool_calls";

// ───────────────────────────────────────────────────────────── formatting

const tokensOf = (s: Sums) =>
  s.input_tokens + s.output_tokens + s.cache_read_tokens + s.cache_write_tokens + s.reasoning_tokens;

function compact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(n));
}
const money = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const prettyDay = (iso: string) => {
  const d = parseDay(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};
const plural = (n: number, one: string, many = `${one}s`) => `${compact(n)} ${n === 1 ? one : many}`;

const METRICS: { id: Metric; label: string }[] = [
  { id: "tokens", label: "Tokens" },
  { id: "sessions", label: "Sessions" },
  { id: "messages", label: "Messages" },
  { id: "tool_calls", label: "Tool calls" },
];
const metricValue = (row: Sums | undefined, m: Metric) =>
  !row ? 0 : m === "tokens" ? tokensOf(row) : m === "sessions" ? row.sessions + row.subagent_sessions : row[m];
const metricLabel = (v: number, m: Metric) =>
  m === "tokens"
    ? plural(v, "token")
    : m === "sessions"
      ? plural(v, "session")
      : m === "messages"
        ? plural(v, "message")
        : plural(v, "tool call");

// ───────────────────────────────────────────────────────────── data path (cli.exec)

let CTX: PluginContext | null = null;

function scopeOf(owner: FocusedSessionOwner | null): FocusedSessionOwner | null {
  const connectionId = String(owner?.connectionId || "").trim();
  const profile = String(owner?.profile || "").trim();
  return connectionId && profile ? { connectionId, profile } : null;
}

async function resolveRoute(scope: FocusedSessionOwner | null): Promise<ProfileRoute> {
  const routes = await host.profileRoutes();
  const exact = scope ? routes.filter((r) => r.connectionId === scope.connectionId && r.profile === scope.profile) : [];
  if (exact.length === 1) return exact[0];
  // No focused chat (or it's ambiguous): fall back to the desktop's primary local route.
  const fallback = routes.find((r) => r.primary) ?? routes.find((r) => r.mode === "local") ?? routes[0];
  if (!fallback) throw new Error("No Hermes profile route available");
  return fallback;
}

/** cli.exec joins stdout+stderr; pick the last line that parses as a JSON object. */
function parseCliJson<T>(output: string): T {
  const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith("{")) continue;
    try {
      return JSON.parse(lines[i]) as T;
    } catch {
      /* keep looking */
    }
  }
  throw new Error(output.trim().split("\n").slice(-3).join(" ") || "empty output from hermes activity");
}

async function activityCli<T>(scope: FocusedSessionOwner | null, argv: string[]): Promise<T> {
  const route = await resolveRoute(scope);
  const res = await host.requestProfile<{ blocked?: boolean; hint?: string; code: number; output: string }>(
    route,
    "cli.exec",
    { argv: ["--profile", route.targetProfile, "activity", ...argv, "--json"], timeout: CLI_TIMEOUT_MS / 1000 },
    CLI_TIMEOUT_MS + 5_000,
  );
  if (res.blocked) throw new Error(res.hint || "cli.exec blocked");
  const payload = parseCliJson<T & { error?: string }>(res.output || "");
  if (payload.error) throw new Error(payload.error);
  return payload;
}

function useScope() {
  const owner = useValue(host.state.focusedSessionOwner);
  const scope = scopeOf(owner);
  return { scope, key: scope ? `${scope.connectionId}::${scope.profile}` : "primary" };
}

/** Invalidate our queries when a turn finishes, so numbers stay current without polling. */
function useRefreshOnTurnEnd(prefix: readonly unknown[]) {
  const busy = useValue(host.state.busy);
  const qc = useQueryClient();
  const was = useRef(busy);
  useEffect(() => {
    if (was.current && !busy) void qc.invalidateQueries({ queryKey: prefix });
    was.current = busy;
  }, [busy, qc, prefix]);
}

// ───────────────────────────────────────────────────────────── small UI atoms (Usage-panel styling)

const LABEL = "text-[0.625rem] font-medium uppercase tracking-[0.08em] text-(--ui-text-tertiary)";
const CAPTION = "text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)";
const TEXT = "text-[length:var(--conversation-text-font-size)] text-foreground";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[0.625rem] font-medium uppercase tracking-[0.12em] text-(--ui-text-tertiary)">{label}</div>
      <div className="mt-1 truncate text-base font-semibold tracking-tight text-foreground" title={value}>
        {value}
      </div>
      {hint && <div className="mt-0.5 truncate text-[0.62rem] text-(--ui-text-tertiary)">{hint}</div>}
    </div>
  );
}

function Section({ title, trailing, children }: { title: string; trailing?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className={LABEL}>{title}</span>
        {trailing}
      </div>
      {children}
    </section>
  );
}

function List({ rows, empty }: { rows: { key: string; label: string; value: string; hint?: string }[]; empty: string }) {
  if (!rows.length) return <div className={CAPTION}>{empty}</div>;
  return (
    <ul>
      {rows.map((r) => (
        <li className="flex items-center justify-between gap-2 py-1.5" key={r.key}>
          <span className="min-w-0 truncate font-mono text-[0.7rem] text-foreground" title={r.label}>
            {r.label}
          </span>
          <span className="shrink-0 text-[0.7rem] text-(--ui-text-tertiary)">
            {r.value}
            {r.hint ? ` · ${r.hint}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function IconButton({ label, icon, onClick, spinning }: { label: string; icon: string; onClick: () => void; spinning?: boolean }) {
  return (
    <button
      aria-label={label}
      className="inline-flex size-6 items-center justify-center rounded text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground"
      onClick={onClick}
      title={label}
      type="button"
    >
      <Codicon name={icon} spinning={spinning} />
    </button>
  );
}

/** Theme-derived cell colour. Level 0 is a faint wash of the text colour. */
const levelColor = (level: number) =>
  level === 0
    ? "color-mix(in srgb, currentColor 9%, transparent)"
    : `color-mix(in srgb, var(--ui-accent) ${[0, 30, 52, 76, 100][level]}%, transparent)`;

// ───────────────────────────────────────────────────────────── contribution grid

const CELL = 11;
const GAP = 3;

function ContributionGrid({
  data,
  metric,
  start,
  end,
  selected,
  onSelect,
}: {
  data: DailyRow[];
  metric: Metric;
  start: string;
  end: string;
  selected: string | null;
  onSelect: (day: string | null) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);

  const model = useMemo(() => {
    const byDay = new Map(data.map((d) => [d.day, d]));
    const first = parseDay(start);
    const last = parseDay(end);
    // Columns are Sunday-first weeks, cropped to the range (so 30d isn't a mostly blank year).
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - first.getDay());
    const weeks = Math.ceil(((last.getTime() - gridStart.getTime()) / 86_400_000 + 1) / 7);

    const values = data.map((d) => metricValue(d, metric)).filter((v) => v > 0).sort((a, b) => a - b);
    const q = (p: number) => values[Math.min(values.length - 1, Math.floor(p * values.length))] ?? 0;
    const th = [q(0.25), q(0.5), q(0.75)];
    const level = (v: number) => (v <= 0 ? 0 : v <= th[0] ? 1 : v <= th[1] ? 2 : v <= th[2] ? 3 : 4);

    const cols: { month: string; cells: { day: string; v: number; level: number; out: boolean }[] }[] = [];
    let prevMonth = -1;
    for (let w = 0; w < weeks; w++) {
      const colStart = new Date(gridStart);
      colStart.setDate(gridStart.getDate() + w * 7);
      const firstInRange = colStart < first ? first : colStart;
      const m = firstInRange.getMonth();
      const month = m !== prevMonth ? MONTHS[m] : "";
      prevMonth = m;
      const cells = [];
      for (let dow = 0; dow < 7; dow++) {
        const d = new Date(colStart);
        d.setDate(colStart.getDate() + dow);
        const key = isoDay(d);
        const out = d < first || d > last;
        const v = out ? 0 : metricValue(byDay.get(key), metric);
        cells.push({ day: key, v, level: level(v), out });
      }
      cols.push({ month, cells });
    }
    // Labels are wider than a column: drop the first one if the next month starts right after it.
    if (cols[0]?.month && (cols[1]?.month || cols[2]?.month)) cols[0].month = "";
    return cols;
  }, [data, metric, start, end]);

  const show = (el: HTMLElement) => {
    const day = el.dataset.day;
    if (!day || !wrap.current) return;
    const box = wrap.current.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setTip({
      text: `${metricLabel(Number(el.dataset.v), metric)} on ${prettyDay(day)}`,
      x: r.left - box.left + r.width / 2 + wrap.current.scrollLeft,
      y: r.top - box.top,
    });
  };

  const labelCol: CSSProperties = { display: "grid", gridTemplateRows: `14px repeat(7, ${CELL}px)`, gap: GAP, marginRight: 6 };

  return (
    <div className="relative overflow-x-auto pb-1" ref={wrap} onMouseLeave={() => setTip(null)}>
      <div style={{ display: "flex", width: "max-content" }}>
        <div aria-hidden style={labelCol}>
          <span />
          {WEEKDAYS.map((d, i) => (
            <span className="text-[0.6rem] leading-[11px] text-(--ui-text-tertiary)" key={d}>
              {i % 2 === 1 ? d : ""}
            </span>
          ))}
        </div>
        <div
          role="grid"
          aria-label="Activity by day"
          style={{ display: "grid", gridAutoFlow: "column", gridTemplateRows: `14px repeat(7, ${CELL}px)`, gridAutoColumns: CELL, gap: GAP }}
          onMouseOver={(e) => {
            const el = (e.target as HTMLElement).closest<HTMLElement>("[data-day]");
            if (el) show(el);
          }}
          onFocus={(e) => {
            const el = (e.target as HTMLElement).closest<HTMLElement>("[data-day]");
            if (el) show(el);
          }}
          onClick={(e) => {
            const el = (e.target as HTMLElement).closest<HTMLElement>("[data-day]");
            if (el?.dataset.day) onSelect(selected === el.dataset.day ? null : el.dataset.day);
          }}
          onKeyDown={(e) => {
            const el = (e.target as HTMLElement).closest<HTMLElement>("[data-day]");
            if (el?.dataset.day && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              onSelect(selected === el.dataset.day ? null : el.dataset.day);
            }
          }}
        >
          {model.map((col, ci) => [
            <span
              className="overflow-visible whitespace-nowrap text-[0.6rem] leading-[14px] text-(--ui-text-tertiary)"
              key={`m${ci}`}
            >
              {col.month}
            </span>,
            ...col.cells.map((c) =>
              c.out ? (
                <span key={c.day} />
              ) : (
                <span
                  aria-label={`${metricLabel(c.v, metric)} on ${prettyDay(c.day)}`}
                  aria-selected={selected === c.day}
                  data-day={c.day}
                  data-v={c.v}
                  key={c.day}
                  role="gridcell"
                  style={{
                    width: CELL,
                    height: CELL,
                    borderRadius: 2,
                    background: levelColor(c.level),
                    cursor: "pointer",
                    outline: selected === c.day ? "1px solid var(--ui-text-primary, currentColor)" : undefined,
                    outlineOffset: 1,
                  }}
                  tabIndex={0}
                />
              ),
            ),
          ])}
        </div>
      </div>
      {tip && (
        <div
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) px-2 py-1 text-[0.68rem] text-foreground shadow-md"
          style={{ left: tip.x, top: tip.y - 6, transform: "translate(-50%, -100%)" }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}

function Legend() {
  return (
    <span className="inline-flex items-center gap-1 text-[0.6rem] text-(--ui-text-tertiary)">
      Less
      {[0, 1, 2, 3, 4].map((l) => (
        <span key={l} style={{ width: CELL, height: CELL, borderRadius: 2, background: levelColor(l) }} />
      ))}
      More
    </span>
  );
}

// ───────────────────────────────────────────────────────────── other visualisations

function TokenMix({ t }: { t: Sums }) {
  const parts = [
    { label: "Input", v: t.input_tokens, color: "var(--ui-blue, var(--ui-accent))" },
    { label: "Output", v: t.output_tokens, color: "var(--ui-accent)" },
    { label: "Reasoning", v: t.reasoning_tokens, color: "var(--ui-purple, var(--ui-accent-secondary))" },
    { label: "Cache write", v: t.cache_write_tokens, color: "var(--ui-yellow, var(--ui-warm))" },
    { label: "Cache read", v: t.cache_read_tokens, color: "color-mix(in srgb, currentColor 22%, transparent)" },
  ];
  const sum = parts.reduce((a, p) => a + p.v, 0) || 1;
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full" style={{ background: levelColor(0) }}>
        {parts.map((p) => (p.v > 0 ? <span key={p.label} style={{ width: `${(p.v / sum) * 100}%`, background: p.color }} /> : null))}
      </div>
      <ul className="mt-2">
        {parts.map((p) => (
          <li className="flex items-center justify-between gap-2 py-1" key={p.label}>
            <span className="inline-flex items-center gap-1.5 text-[0.7rem] text-foreground">
              <span className="size-2 rounded-[1px]" style={{ background: p.color }} />
              {p.label}
            </span>
            <span className="text-[0.7rem] text-(--ui-text-tertiary)">
              {compact(p.v)} · {((p.v / sum) * 100).toFixed(p.v / sum < 0.01 ? 1 : 0)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Punchcard({ rows }: { rows: Summary["punchcard"] }) {
  const max = Math.max(1, ...rows.map((r) => r.sessions));
  const at = new Map(rows.map((r) => [`${r.weekday}:${r.hour}`, r.sessions]));
  return (
    <div className="overflow-x-auto">
      <div style={{ display: "grid", gridTemplateColumns: `28px repeat(24, minmax(10px, 1fr))`, gap: 3, minWidth: 340 }}>
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span className="text-center text-[0.55rem] text-(--ui-text-tertiary)" key={h}>
            {h % 6 === 0 ? h : ""}
          </span>
        ))}
        {WEEKDAYS.map((wd, w) => [
          <span className="text-[0.6rem] leading-[12px] text-(--ui-text-tertiary)" key={wd}>
            {wd}
          </span>,
          ...Array.from({ length: 24 }, (_, h) => {
            const n = at.get(`${w}:${h}`) ?? 0;
            const level = n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4));
            return (
              <span
                key={`${w}:${h}`}
                style={{ height: 12, borderRadius: 2, background: levelColor(level) }}
                title={`${wd} ${pad(h)}:00 · ${plural(n, "session")}`}
              />
            );
          }),
        ])}
      </div>
    </div>
  );
}

function SessionRows({ sessions, empty }: { sessions: SessionRow[]; empty: string }) {
  if (!sessions.length) return <div className={CAPTION}>{empty}</div>;
  const open = (id: string) => {
    if (typeof host.openSession === "function") void host.openSession(id);
  };
  return (
    <ul>
      {sessions.map((s) => (
        <li key={s.id}>
          <button className="flex w-full items-center gap-3 py-2 text-left" onClick={() => open(s.id)} type="button">
            <div className="min-w-0 flex-1">
              <div className={`truncate font-medium ${TEXT}`}>{s.title || s.id}</div>
              <div className={`truncate ${CAPTION}`}>
                {[
                  new Date(s.started_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                  s.source,
                  s.model,
                  s.parent_session_id ? "subagent" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            <div className="shrink-0 text-right text-[0.7rem] text-(--ui-text-tertiary)">
              <div className="text-foreground">{compact(s.tokens)}</div>
              <div>
                {s.messages} msgs · {s.tool_calls} tools
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ───────────────────────────────────────────────────────────── page

function streaks(daily: DailyRow[]) {
  const active = new Set(daily.filter((d) => d.sessions + d.subagent_sessions > 0).map((d) => d.day));
  let longest = 0;
  let run = 0;
  let prev = "";
  for (const day of [...active].sort()) {
    const p = parseDay(day);
    p.setDate(p.getDate() - 1);
    run = prev && isoDay(p) === prev ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = day;
  }
  let current = 0;
  const d = new Date();
  if (!active.has(isoDay(d))) d.setDate(d.getDate() - 1);
  while (active.has(isoDay(d))) {
    current++;
    d.setDate(d.getDate() - 1);
  }
  return { current, longest: Math.max(longest, current), activeDays: active.size };
}

function rangeArgs(range: string): string[] {
  return /^\d{4}$/.test(range) ? ["--year", range] : ["--days", range];
}

function ActivityPage() {
  const { scope, key } = useScope();
  const [range, setRange] = useState(() => CTX?.storage.get("range") || "365");
  const [metric, setMetric] = useState<Metric>(() => (CTX?.storage.get("metric") as Metric) || "tokens");
  const [selected, setSelected] = useState<string | null>(null);
  useRefreshOnTurnEnd(PREFIX);

  const q = useQuery<Summary>({
    queryKey: [...PREFIX, "summary", key, range],
    queryFn: () => activityCli<Summary>(scope, ["summary", ...rangeArgs(range)]),
    staleTime: 5 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });
  const dayQ = useQuery<DayPayload>({
    queryKey: [...PREFIX, "day", key, selected],
    queryFn: () => activityCli<DayPayload>(scope, ["day", selected as string]),
    enabled: !!selected,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const data = q.data;
  const thisYear = new Date().getFullYear();
  const firstYear = data?.first_activity_day ? parseDay(data.first_activity_day).getFullYear() : thisYear;
  const rangeOptions = [
    { id: "30", label: "30d" },
    { id: "90", label: "90d" },
    { id: "365", label: "12m" },
    ...Array.from({ length: Math.min(5, thisYear - firstYear + 1) }, (_, i) => String(thisYear - i)).map((y) => ({ id: y, label: y })),
  ];

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3 pb-4 pt-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Codicon name="graph" />
          <h1 className="text-base font-semibold tracking-tight text-foreground">Activity</h1>
        </div>
        <div className={`mt-0.5 ${CAPTION}`}>
          {data ? `${prettyDay(data.range.start)} – ${prettyDay(data.range.end)}` : "Your Hermes usage, read from the local session store"}
          {scope?.profile ? ` · ${scope.profile}` : ""}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <SegmentedControl
          onChange={(id) => {
            setRange(id);
            setSelected(null);
            CTX?.storage.set("range", id);
          }}
          options={rangeOptions}
          value={range}
        />
        <IconButton icon="refresh" label="Refresh" onClick={() => void q.refetch()} spinning={q.isFetching} />
      </div>
    </div>
  );

  const shell = (children: ReactNode) => (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-[clamp(1.25rem,4vw,4rem)] pb-8">
      {header}
      {children}
    </div>
  );

  if (!data) {
    if (q.error) {
      const msg = q.error instanceof Error ? q.error.message : String(q.error);
      return shell(
        <div className="grid place-items-center gap-2 py-16 text-center">
          <Codicon name="warning" />
          <div className={TEXT}>Couldn't load activity</div>
          <div className={`max-w-md ${CAPTION}`}>{msg}</div>
          <div className={`max-w-md ${CAPTION}`}>
            Make sure the hermes-activity plugin is enabled for this profile: <code>hermes plugins enable hermes-activity</code>
          </div>
          <button className="mt-2 text-[0.75rem] text-(--ui-accent) hover:underline" onClick={() => void q.refetch()} type="button">
            Retry
          </button>
        </div>,
      );
    }
    return shell(
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton className="h-10" key={i} />
          ))}
        </div>
        <Skeleton className="h-32" />
        <Skeleton className="h-40" />
      </div>,
    );
  }

  const t = data.totals;
  const total = tokensOf(t);
  const st = streaks(data.daily);
  const top = data.models[0];
  const topShare = top && total ? (tokensOf(top) / total) * 100 : 0;
  const unpriced = data.models.filter((m) => m.priced_sessions === 0 && tokensOf(m) > 0).length;
  const gridTotal = data.daily.reduce((a, d) => a + metricValue(d, metric), 0);
  const rangeLabel = /^\d{4}$/.test(range) ? `in ${range}` : range === "365" ? "in the last year" : `in the last ${range} days`;
  const noActivity = data.daily.length === 0;

  return shell(
    <div className="flex flex-col gap-7">
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
        <Stat label="Total tokens" value={compact(total)} hint="incl. cache" />
        <Stat label="Input" value={compact(t.input_tokens)} hint={`${compact(t.cache_read_tokens)} cache read`} />
        <Stat label="Output" value={compact(t.output_tokens)} hint={`${compact(t.reasoning_tokens)} reasoning`} />
        <Stat
          label="Most used model"
          value={top ? top.model : "—"}
          hint={top ? `${topShare.toFixed(0)}% of tokens${top.provider ? ` · ${top.provider}` : ""}` : undefined}
        />
        <Stat label="Sessions" value={compact(t.sessions)} hint={`${compact(t.subagent_sessions)} subagent · ${compact(t.messages)} msgs`} />
        <Stat label="Tool calls" value={compact(t.tool_calls)} hint={`${compact(t.api_calls)} API calls`} />
        <Stat
          label="Est. cost"
          value={t.cost_usd > 0 ? money(t.cost_usd) : "—"}
          hint={unpriced ? `${unpriced} model${unpriced === 1 ? "" : "s"} unpriced` : "all models priced"}
        />
        <Stat label="Streak" value={plural(st.current, "day")} hint={`longest ${st.longest} · ${st.activeDays} active days`} />
      </div>

      <Section
        title={`${metricLabel(gridTotal, metric)} ${rangeLabel}`}
        trailing={
          <SegmentedControl
            onChange={(m) => {
              setMetric(m);
              CTX?.storage.set("metric", m);
            }}
            options={METRICS}
            value={metric}
          />
        }
      >
        <ContributionGrid
          data={data.daily}
          end={data.range.end}
          metric={metric}
          onSelect={setSelected}
          selected={selected}
          start={data.range.start}
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-[0.6rem] text-(--ui-text-tertiary)">
            {noActivity ? "No sessions in this range yet." : "Days use local time, by session start. Click a day for its sessions."}
          </span>
          <Legend />
        </div>
      </Section>

      {selected && (
        <Section
          title={`${prettyDay(selected)}`}
          trailing={<IconButton icon="close" label="Close day" onClick={() => setSelected(null)} />}
        >
          {dayQ.isLoading ? (
            <Skeleton className="h-16" />
          ) : dayQ.error ? (
            <div className={CAPTION}>{dayQ.error instanceof Error ? dayQ.error.message : String(dayQ.error)}</div>
          ) : (
            <SessionRows empty="No sessions started that day." sessions={dayQ.data?.sessions ?? []} />
          )}
        </Section>
      )}

      <div className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
        <Section title="Token mix">
          <TokenMix t={t} />
        </Section>
        <Section title="Models">
          <List
            empty="No model usage in this range."
            rows={data.models.slice(0, 8).map((m) => ({
              key: `${m.model}::${m.provider ?? ""}`,
              label: m.model,
              value: compact(tokensOf(m)),
              hint: plural(m.sessions + m.subagent_sessions, "session"),
            }))}
          />
        </Section>
        <Section title="Top tools">
          <List
            empty="No tool calls in this range."
            rows={data.tools.slice(0, 8).map((x) => ({ key: x.tool, label: x.tool, value: compact(x.count) }))}
          />
        </Section>
        <Section title="Top skills">
          <List
            empty="No skills used in this range."
            rows={(data.skills.top_skills ?? []).slice(0, 8).map((x) => ({ key: x.skill, label: x.skill, value: plural(x.total_count, "use") }))}
          />
        </Section>
        <Section title="Platforms">
          <List
            empty="No sessions in this range."
            rows={data.sources.map((x) => ({ key: x.source, label: x.source, value: plural(x.sessions, "session"), hint: compact(x.tokens) }))}
          />
        </Section>
        <Section title="When you work">
          <Punchcard rows={data.punchcard} />
        </Section>
      </div>

      <Section title="Notable sessions">
        <SessionRows
          empty="No sessions in this range."
          sessions={(["most_tokens", "most_messages", "most_tool_calls", "most_expensive"] as const)
            .map((k) => data.notable[k])
            .filter((s, i, all): s is SessionRow => !!s && all.findIndex((x) => x?.id === s.id) === i)}
        />
      </Section>

      <div className="text-[0.6rem] text-(--ui-text-tertiary)">
        hermes-activity v{WIDGET_VERSION}
        {data.plugin_version !== WIDGET_VERSION ? ` · backend v${data.plugin_version} (reload desktop plugins to match)` : ""} · read-only, local
        session store
      </div>
    </div>,
  );
}

// ───────────────────────────────────────────────────────────── status bar chip

const PREFIX = [ID] as const;

function StatusChip() {
  const { scope, key } = useScope();
  useRefreshOnTurnEnd(PREFIX);
  const q = useQuery<Lite>({
    queryKey: [...PREFIX, "today", key],
    queryFn: () => activityCli<Lite>(scope, ["summary", "--days", "1", "--lite"]),
    staleTime: 5 * 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
  });
  if (!q.data) return null; // stay invisible until we have a real number (or if the backend is off)
  const today = tokensOf(q.data.totals);
  return (
    <button
      aria-label={`Today: ${plural(today, "token")} · open Activity`}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6875rem] text-(--ui-text-secondary) transition-colors hover:bg-(--chrome-action-hover)"
      onClick={() => host.navigate(ROUTE)}
      title={`Today: ${plural(today, "token")}, ${plural(q.data.totals.sessions, "session")}`}
      type="button"
    >
      <Codicon name="graph" />
      {compact(today)}
    </button>
  );
}

// ───────────────────────────────────────────────────────────── registration

export default {
  id: ID,
  name: "Activity",
  register(ctx: PluginContext) {
    CTX = ctx;
    ctx.register({ id: "page", area: ROUTES_AREA, data: { path: ROUTE }, render: () => <ActivityPage /> });
    ctx.register({ id: "nav", area: SIDEBAR_NAV_AREA, order: 85, data: { path: ROUTE, label: "Activity", codicon: "graph" } });
    ctx.register({
      id: "open",
      area: PALETTE_AREA,
      data: { id: `${ID}.open`, label: "Open Activity", keywords: ["activity", "usage", "tokens", "insights", "contributions"], run: () => host.navigate(ROUTE) },
    });
    ctx.register({ id: "statusbar", area: STATUSBAR_AREAS.right, order: 130, render: () => <StatusChip /> });
  },
};
