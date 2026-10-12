export type ProviderMetric = "requests" | "tokens" | "spend";

export interface ProviderStatus {
  id: string;
  supported: boolean;
  has_history: boolean;
}

export interface ProviderDailyRow {
  provider: string;
  day: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  reasoning_tokens: number;
  tokens: number;
  cost_usd: string | null;
}

export const OVERVIEW_STATUSES = ["available", "summary-only", "auth-required", "unavailable", "not-collected", "not-integrated"] as const;
export type OverviewStatus = (typeof OVERVIEW_STATUSES)[number];

export interface OverviewPeriodModel {
  model: string;
  requests: number | null;
  tokens: number | null;
  cost_usd: string | null;
}

export interface OverviewPeriod {
  label: string;
  basis: string;
  start: string | null;
  end: string | null;
  requests: number | null;
  tokens: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: string | null;
  models: OverviewPeriodModel[];
}

export interface OverviewDailyRow {
  day: string;
  requests: number | null;
  tokens: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  cost_usd: string | null;
}

export const EMPTY_PROVIDER_BREAKDOWN: ProviderBreakdown = {
  tokens: null,
  input_tokens: null,
  output_tokens: null,
  cache_read_tokens: null,
  cache_write_tokens: null,
  reasoning_tokens: null,
  requests: null,
  cost_usd: null,
  active_days: 0,
  reported_days: 0,
};

export interface ProviderBreakdown {
  tokens: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  requests: number | null;
  cost_usd: string | null;
  active_days: number;
  reported_days: number;
}

export const BREAKDOWN_SUM_METRICS = [
  "requests",
  "tokens",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "reasoning_tokens",
] as const;

export type BreakdownSumMetric = (typeof BREAKDOWN_SUM_METRICS)[number];
export type BreakdownMetric = BreakdownSumMetric | "spend";

function dayIsActive(row: OverviewDailyRow): boolean {
  return BREAKDOWN_SUM_METRICS.some((metric) => (row[metric] ?? 0) > 0) ||
    (row.cost_usd !== null && Number(row.cost_usd) > 0);
}

export function breakdownFromDaily(daily: OverviewDailyRow[]): ProviderBreakdown {
  const breakdown: ProviderBreakdown = { ...EMPTY_PROVIDER_BREAKDOWN, reported_days: daily.length };
  for (const metric of BREAKDOWN_SUM_METRICS) {
    let total = 0;
    let seen = false;
    for (const row of daily) {
      const value = row[metric];
      if (value !== null && Number.isFinite(value)) {
        total += value;
        seen = true;
      }
    }
    breakdown[metric] = seen ? total : null;
  }
  breakdown.cost_usd = sumDecimalStrings(
    daily.map((row) => row.cost_usd).filter((cost): cost is string => cost !== null),
  );
  breakdown.active_days = daily.filter(dayIsActive).length;
  return breakdown;
}

export interface OverviewWindow {
  label: string;
  used_percent: number | null;
  reset_at: string | null;
}

export interface ProviderOverview {
  id: string;
  status: OverviewStatus;
  reason: string | null;
  scope: string;
  source: string;
  data_as_of: string | null;
  fetched_at: string | null;
  note: string;
  periods: OverviewPeriod[];
  daily: OverviewDailyRow[];
  breakdown: ProviderBreakdown;
  windows: OverviewWindow[];
}

export interface ProviderHistory {
  schema_version: 1;
  scope: "provider-account";
  range: { start: string; end: string; days: number };
  provider_filter: string;
  providers: ProviderStatus[];
  daily: ProviderDailyRow[];
  overview: ProviderOverview[];
}

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function invalid(part: string): never {
  throw new Error(`Invalid provider history ${part}`);
}

function requiredText(value: unknown): string {
  if (typeof value === "string" && value.trim() !== "") return value;
  return invalid("overview text");
}

function nullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return invalid("overview text");
}

function noteText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return invalid("overview note");
}

function nullableInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (nonnegativeInteger(value)) return value;
  return invalid("overview metric");
}

function nullableDecimal(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && DECIMAL.test(value)) return value;
  return invalid("overview cost");
}

function nullableStamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (isDay(value) || isTimestamp(value)) return value;
  return invalid("overview timestamp");
}

function nullablePercent(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return invalid("overview window");
}

function parseOverviewPeriodModel(entry: unknown): OverviewPeriodModel {
  if (!isRecord(entry)) return invalid("overview model");
  return {
    model: requiredText(entry.model),
    requests: nullableInteger(entry.requests),
    tokens: nullableInteger(entry.tokens),
    cost_usd: nullableDecimal(entry.cost_usd),
  };
}

function parseOverviewPeriod(entry: unknown): OverviewPeriod {
  if (!isRecord(entry) || !Array.isArray(entry.models)) return invalid("overview period");
  return {
    label: requiredText(entry.label),
    basis: requiredText(entry.basis),
    start: nullableStamp(entry.start),
    end: nullableStamp(entry.end),
    requests: nullableInteger(entry.requests),
    tokens: nullableInteger(entry.tokens),
    input_tokens: nullableInteger(entry.input_tokens),
    output_tokens: nullableInteger(entry.output_tokens),
    cost_usd: nullableDecimal(entry.cost_usd),
    models: entry.models.map(parseOverviewPeriodModel),
  };
}

function parseOverviewDailyRow(entry: unknown): OverviewDailyRow {
  if (!isRecord(entry) || !isDay(entry.day)) return invalid("overview daily row");
  return {
    day: entry.day,
    requests: nullableInteger(entry.requests),
    tokens: nullableInteger(entry.tokens),
    input_tokens: nullableInteger(entry.input_tokens),
    output_tokens: nullableInteger(entry.output_tokens),
    cache_read_tokens: nullableInteger(entry.cache_read_tokens),
    cache_write_tokens: nullableInteger(entry.cache_write_tokens),
    reasoning_tokens: nullableInteger(entry.reasoning_tokens),
    cost_usd: nullableDecimal(entry.cost_usd),
  };
}

function parseOverviewWindow(entry: unknown): OverviewWindow {
  if (!isRecord(entry)) return invalid("overview window");
  return {
    label: requiredText(entry.label),
    used_percent: nullablePercent(entry.used_percent),
    reset_at: nullableText(entry.reset_at),
  };
}

function parseProviderBreakdown(entry: unknown): ProviderBreakdown {
  if (!isRecord(entry)) return invalid("overview breakdown");
  return {
    tokens: nullableInteger(entry.tokens),
    input_tokens: nullableInteger(entry.input_tokens),
    output_tokens: nullableInteger(entry.output_tokens),
    cache_read_tokens: nullableInteger(entry.cache_read_tokens),
    cache_write_tokens: nullableInteger(entry.cache_write_tokens),
    reasoning_tokens: nullableInteger(entry.reasoning_tokens),
    requests: nullableInteger(entry.requests),
    cost_usd: nullableDecimal(entry.cost_usd),
    active_days: nonnegativeInteger(entry.active_days) ? entry.active_days : invalid("overview breakdown"),
    reported_days: nonnegativeInteger(entry.reported_days) ? entry.reported_days : invalid("overview breakdown"),
  };
}

function parseProviderOverview(entry: unknown): ProviderOverview {
  if (!isRecord(entry) || !Array.isArray(entry.periods) || !Array.isArray(entry.daily) || !Array.isArray(entry.windows)) {
    return invalid("overview provider");
  }
  if (typeof entry.status !== "string" || !(OVERVIEW_STATUSES as readonly string[]).includes(entry.status)) {
    return invalid("overview status");
  }
  const daily = entry.daily.map(parseOverviewDailyRow);
  return {
    id: requiredText(entry.id),
    status: entry.status as OverviewStatus,
    reason: nullableText(entry.reason),
    scope: requiredText(entry.scope),
    source: requiredText(entry.source),
    data_as_of: nullableStamp(entry.data_as_of),
    fetched_at: nullableStamp(entry.fetched_at),
    note: noteText(entry.note),
    periods: entry.periods.map(parseOverviewPeriod),
    daily,
    breakdown: entry.breakdown === undefined || entry.breakdown === null
      ? breakdownFromDaily(daily)
      : parseProviderBreakdown(entry.breakdown),
    windows: entry.windows.map(parseOverviewWindow),
  };
}

export function parseProviderHistory(value: unknown): ProviderHistory {
  if (!isRecord(value) || value.schema_version !== 1 || value.scope !== "provider-account" ||
      !isRecord(value.range) || !isDay(value.range.start) || !isDay(value.range.end) ||
      !nonnegativeInteger(value.range.days) || value.range.days < 1 || value.range.days > 365 ||
      typeof value.provider_filter !== "string" || !Array.isArray(value.providers) || !Array.isArray(value.daily)) {
    throw new Error("Invalid provider history payload");
  }
  const providers = value.providers.map((entry): ProviderStatus => {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id ||
        typeof entry.supported !== "boolean" || typeof entry.has_history !== "boolean") {
      throw new Error("Invalid provider history provider status");
    }
    return { id: entry.id, supported: entry.supported, has_history: entry.has_history };
  });
  const daily = value.daily.map((entry): ProviderDailyRow => {
    if (!isRecord(entry) || typeof entry.provider !== "string" || !entry.provider || !isDay(entry.day) ||
        !nonnegativeInteger(entry.requests) || !nonnegativeInteger(entry.input_tokens) ||
        !nonnegativeInteger(entry.output_tokens) || !nonnegativeInteger(entry.cache_read_tokens) ||
        !nonnegativeInteger(entry.reasoning_tokens) || !nonnegativeInteger(entry.tokens) ||
        !(entry.cost_usd === null || (typeof entry.cost_usd === "string" && DECIMAL.test(entry.cost_usd)))) {
      throw new Error("Invalid provider history daily row");
    }
    return {
      provider: entry.provider,
      day: entry.day,
      requests: entry.requests,
      input_tokens: entry.input_tokens,
      output_tokens: entry.output_tokens,
      cache_read_tokens: entry.cache_read_tokens,
      reasoning_tokens: entry.reasoning_tokens,
      tokens: entry.tokens,
      cost_usd: entry.cost_usd,
    };
  });
  let overview: ProviderOverview[] = [];
  if (value.overview !== undefined && value.overview !== null) {
    if (!Array.isArray(value.overview)) throw new Error("Invalid provider history overview");
    overview = value.overview.map(parseProviderOverview);
  }
  return {
    schema_version: 1,
    scope: "provider-account",
    range: { start: value.range.start, end: value.range.end, days: value.range.days },
    provider_filter: value.provider_filter,
    providers,
    daily,
    overview,
  };
}

export function providerMetricValue(row: ProviderDailyRow, metric: ProviderMetric): number {
  if (metric === "requests") return row.requests;
  if (metric === "tokens") return row.tokens;
  const cost = row.cost_usd === null ? 0 : Number(row.cost_usd);
  return Number.isFinite(cost) ? cost : 0;
}

function compactOverviewNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(value));
}

export function overviewMetricText(value: number | null, kind: "count" | "tokens"): string {
  if (value === null || !Number.isFinite(value)) return "not reported";
  return kind === "tokens" ? compactOverviewNumber(value) : Math.round(value).toLocaleString("en-US");
}

export function overviewSpendText(cost_usd: string | null): string {
  if (cost_usd === null) return "not reported";
  const amount = Number(cost_usd);
  if (!Number.isFinite(amount)) return "not reported";
  if (amount > 0 && amount < 0.01) return "<$0.01";
  return `$${amount.toFixed(2)}`;
}

export function overviewMetricChips(metrics: {
  requests: number | null;
  tokens: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cost_usd: string | null;
}): string[] {
  const chips: string[] = [];
  if (metrics.requests !== null && metrics.requests !== undefined) {
    chips.push(`${overviewMetricText(metrics.requests, "count")} requests`);
  }
  if (metrics.tokens !== null && metrics.tokens !== undefined) {
    chips.push(`${overviewMetricText(metrics.tokens, "tokens")} tokens`);
  } else {
    if (metrics.input_tokens !== null && metrics.input_tokens !== undefined) {
      chips.push(`${overviewMetricText(metrics.input_tokens, "tokens")} input`);
    }
    if (metrics.output_tokens !== null && metrics.output_tokens !== undefined) {
      chips.push(`${overviewMetricText(metrics.output_tokens, "tokens")} output`);
    }
  }
  if (metrics.cost_usd !== null && metrics.cost_usd !== undefined) chips.push(overviewSpendText(metrics.cost_usd));
  return chips;
}

export function overviewDayValue(row: OverviewDailyRow, metric: ProviderMetric): number | null {
  if (metric === "requests") return row.requests;
  if (metric === "tokens") return row.tokens;
  if (row.cost_usd === null) return null;
  const amount = Number(row.cost_usd);
  return Number.isFinite(amount) ? amount : null;
}

export function overviewDaySequence(start: string, end: string): string[] {
  const startMs = isDay(start) ? Date.parse(`${start}T00:00:00Z`) : Number.NaN;
  const endMs = isDay(end) ? Date.parse(`${end}T00:00:00Z`) : Number.NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return [];
  const days: string[] = [];
  for (let time = startMs; time <= endMs; time += 86_400_000) {
    days.push(new Date(time).toISOString().slice(0, 10));
  }
  return days;
}

// ───────────────────────────────────────────────────────────── annual provider window

// Providers always render a fixed rolling annual (365-day / 12-month) timeline, so the
// range control is intentionally not user-selectable here.
export const PROVIDER_WINDOW_DAYS = 365;

// The provider filter always starts on the combined "all" view; a previously persisted
// single-provider selection is deliberately ignored on mount.
export const DEFAULT_PROVIDER_SELECTION = "all";

export function providerHistoryArgs(mode: "cached" | "refresh" = "cached", days: number = PROVIDER_WINDOW_DAYS): string[] {
  return ["provider-history", "--days", String(days), "--desktop", ...(mode === "refresh" ? ["--refresh"] : [])];
}

// ───────────────────────────────────────────────────────────── combined daily aggregation

export interface ProviderDayCoverage {
  /** Providers that reported a row for this UTC day. */
  reported: number;
  /** Providers that have any dated records for the annual window. */
  expected: number;
}

export interface AggregateDailyRow extends OverviewDailyRow {
  coverage: ProviderDayCoverage;
  metricCoverage: Record<ProviderMetric, ProviderDayCoverage>;
}

/** Exact decimal-string addition (no float drift), e.g. "0.1" + "0.2" === "0.3". */
export function sumDecimalStrings(values: string[]): string | null {
  const cleaned = values.filter((value) => DECIMAL.test(value));
  if (!cleaned.length) return null;
  let scale = 0;
  for (const value of cleaned) {
    const fraction = value.includes(".") ? value.split(".")[1].length : 0;
    if (fraction > scale) scale = fraction;
  }
  let total = 0n;
  for (const value of cleaned) {
    const [whole, fraction = ""] = value.split(".");
    total += BigInt(whole + fraction.padEnd(scale, "0"));
  }
  if (scale === 0) return total.toString();
  const digits = total.toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * Builds the combined annual daily series across provider sources.
 *
 * Only dated provider rows participate: summary-only sources report period totals with no
 * dated records, so they never enter the timeline (their totals stay in the source
 * summaries). For every UTC day each metric is the sum of the values sources actually
 * reported; a value no source reported stays null rather than becoming zero. `coverage`
 * records how many sources reported that day so the UI can flag partial coverage.
 */
export function aggregateProviderDaily(
  sources: { id: string; daily: OverviewDailyRow[] }[],
  start: string,
  end: string,
): AggregateDailyRow[] {
  const contributors = sources.filter((source) => source.daily.length > 0);
  const expected = contributors.length;
  const byDay = new Map<string, OverviewDailyRow[]>();
  for (const source of contributors) {
    for (const row of source.daily) {
      const rows = byDay.get(row.day);
      if (rows) rows.push(row);
      else byDay.set(row.day, [row]);
    }
  }
  return overviewDaySequence(start, end).map((day) => {
    const rows = byDay.get(day) ?? [];
    const sum = (pick: (row: OverviewDailyRow) => number | null): number | null => {
      let total = 0;
      let seen = false;
      for (const row of rows) {
        const value = pick(row);
        if (value !== null && Number.isFinite(value)) {
          total += value;
          seen = true;
        }
      }
      return seen ? total : null;
    };
    const row: AggregateDailyRow = {
      day,
      requests: null,
      tokens: null,
      input_tokens: null,
      output_tokens: null,
      cache_read_tokens: null,
      cache_write_tokens: null,
      reasoning_tokens: null,
      cost_usd: sumDecimalStrings(rows.map((entry) => entry.cost_usd).filter((cost): cost is string => cost !== null)),
      coverage: { reported: rows.length, expected },
      metricCoverage: {
        requests: { reported: rows.filter((entry) => entry.requests !== null).length, expected },
        tokens: { reported: rows.filter((entry) => entry.tokens !== null).length, expected },
        spend: { reported: rows.filter((entry) => entry.cost_usd !== null).length, expected },
      },
    };
    for (const metric of BREAKDOWN_SUM_METRICS) row[metric] = sum((entry) => entry[metric]);
    return row;
  });
}

export interface ProviderBreakdownAggregate {
  breakdown: ProviderBreakdown;
  contributors: number;
  metricCoverage: Record<BreakdownMetric, ProviderDayCoverage>;
}

export function aggregateProviderBreakdown(
  sources: { id: string; breakdown: ProviderBreakdown; daily: OverviewDailyRow[] }[],
  start: string,
  end: string,
): ProviderBreakdownAggregate {
  const contributors = sources.filter((source) => source.daily.length > 0);
  const expected = contributors.length;
  const sumMetric = (metric: BreakdownSumMetric): number | null => {
    let total = 0;
    let seen = false;
    for (const source of contributors) {
      const value = source.breakdown[metric];
      if (value !== null && Number.isFinite(value)) {
        total += value;
        seen = true;
      }
    }
    return seen ? total : null;
  };
  const activeDays = new Set<string>();
  const reportedDays = new Set<string>();
  for (const source of contributors) {
    for (const row of source.daily) {
      if (row.day < start || row.day > end) continue;
      reportedDays.add(row.day);
      if (dayIsActive(row)) activeDays.add(row.day);
    }
  }
  const metricCoverage = {} as Record<BreakdownMetric, ProviderDayCoverage>;
  for (const metric of BREAKDOWN_SUM_METRICS) {
    metricCoverage[metric] = {
      reported: contributors.filter((source) => source.breakdown[metric] !== null).length,
      expected,
    };
  }
  metricCoverage.spend = {
    reported: contributors.filter((source) => source.breakdown.cost_usd !== null).length,
    expected,
  };
  return {
    breakdown: {
      tokens: sumMetric("tokens"),
      input_tokens: sumMetric("input_tokens"),
      output_tokens: sumMetric("output_tokens"),
      cache_read_tokens: sumMetric("cache_read_tokens"),
      cache_write_tokens: sumMetric("cache_write_tokens"),
      reasoning_tokens: sumMetric("reasoning_tokens"),
      requests: sumMetric("requests"),
      cost_usd: sumDecimalStrings(
        contributors.map((source) => source.breakdown.cost_usd).filter((cost): cost is string => cost !== null),
      ),
      active_days: activeDays.size,
      reported_days: reportedDays.size,
    },
    contributors: expected,
    metricCoverage,
  };
}

// ───────────────────────────────────────────────────────────── provider token mix

/**
 * Component token series that make up the provider token mix, in render order.
 *
 * A provider only ever reports these `breakdown` components — never tools, skills or
 * platforms — so the mix is built exclusively from them.
 */
export const TOKEN_MIX_KEYS = [
  "input_tokens",
  "output_tokens",
  "reasoning_tokens",
  "cache_write_tokens",
  "cache_read_tokens",
] as const;

export type TokenMixKey = (typeof TOKEN_MIX_KEYS)[number];

export interface TokenMixSegment {
  key: TokenMixKey;
  /** Reported component tokens, or null when the source never reported it. */
  tokens: number | null;
  /** Fraction of the reported total (0-1), or null when the total is unknown. */
  share: number | null;
}

export interface ProviderTokenMix {
  segments: TokenMixSegment[];
  /** Reported token total used as the percentage denominator, or null when unknown. */
  denominator: number | null;
  /** Components the source actually reported. */
  reported: number;
  /** True when some component is unreported or no honest denominator exists. */
  partial: boolean;
}

/**
 * Builds the provider token mix without inventing shares.
 *
 * The denominator is the source's own reported `tokens` total when present (the honest
 * base for a mix: components are subsets of the total), otherwise the sum of the
 * components, but ONLY when every component is reported. If some components are missing
 * and no total is reported, no denominator exists and every share stays null so a partial
 * sum can never masquerade as a full 100%.
 */
export function providerTokenMix(breakdown: ProviderBreakdown): ProviderTokenMix {
  const values = TOKEN_MIX_KEYS.map((key) => breakdown[key]);
  const reported = values.filter((value) => value !== null).length;
  const allReported = reported === TOKEN_MIX_KEYS.length;
  let denominator: number | null = breakdown.tokens;
  if (denominator === null && allReported) {
    denominator = values.reduce<number>((sum, value) => sum + (value as number), 0);
  }
  const segments: TokenMixSegment[] = TOKEN_MIX_KEYS.map((key, index) => {
    const tokens = values[index];
    let share: number | null = null;
    if (denominator !== null && tokens !== null) {
      share = denominator > 0 ? tokens / denominator : 0;
    }
    return { key, tokens, share };
  });
  return { segments, denominator, reported, partial: !allReported || denominator === null };
}

// ───────────────────────────────────────────────────────────── provider model rows

export interface ProviderModelRow {
  /** Source (provider) the period belongs to. */
  source: string;
  /** Period label, e.g. "Last 30 days" or "Lifetime". */
  period: string;
  basis: string;
  model: string;
  requests: number | null;
  tokens: number | null;
  cost_usd: string | null;
}

/**
 * Enumerates each source's per-period model rows.
 *
 * Rows are keyed by (source, period, model) and are NEVER summed across periods: a
 * provider's "Lifetime" or "Last 30 days" model totals stay attached to their own period
 * and are never folded into the annual window or into one another. Model entries with no
 * reported metric are dropped as noise (they carry no data).
 */
export function providerModelBreakdown(history: ProviderHistory): ProviderModelRow[] {
  const rows: ProviderModelRow[] = [];
  for (const record of history.overview) {
    for (const period of record.periods) {
      for (const model of period.models) {
        if (model.requests === null && model.tokens === null && model.cost_usd === null) continue;
        rows.push({
          source: record.id,
          period: period.label,
          basis: period.basis,
          model: model.model,
          requests: model.requests,
          tokens: model.tokens,
          cost_usd: model.cost_usd,
        });
      }
    }
  }
  return rows;
}
