import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EMPTY_PROVIDER_BREAKDOWN,
  overviewDaySequence,
  overviewDayValue,
  overviewMetricChips,
  overviewMetricText,
  overviewSpendText,
  parseProviderHistory,
  providerMetricValue,
  providerModelBreakdown,
  providerTokenMix,
  type ProviderBreakdown,
} from "../src/provider-history.ts";

const payload = {
  schema_version: 1,
  scope: "provider-account",
  range: { start: "2026-10-01", end: "2026-10-31", days: 31 },
  provider_filter: "all",
  providers: [
    { id: "experientiallabs", supported: true, has_history: true },
    { id: "copilot", supported: false, has_history: false },
  ],
  daily: [
    {
      provider: "all",
      day: "2026-10-10",
      requests: 2,
      input_tokens: 40,
      output_tokens: 25,
      cache_read_tokens: 5,
      reasoning_tokens: 2,
      tokens: 72,
      cost_usd: "0.0573",
    },
  ],
};

const commandCodeRecord = {
  id: "commandcode",
  status: "summary-only",
  reason: null,
  scope: "account",
  source: "CommandCode summary API",
  data_as_of: "2026-10-12",
  fetched_at: "2026-10-12T05:00:00Z",
  note: "Summary only; no dated records are exposed.",
  periods: [
    {
      label: "Last 30 days",
      basis: "last-30-days",
      start: null,
      end: null,
      requests: 1076,
      tokens: 157290712,
      input_tokens: null,
      output_tokens: null,
      cost_usd: "11.425157022999999",
      models: [{ model: "unknown", requests: null, tokens: null, cost_usd: null }],
    },
  ],
  daily: [],
  windows: [],
};

const openCodeRecord = {
  id: "opencode-go",
  status: "available",
  reason: null,
  scope: "workspace",
  source: "OpenCode v2 CSV export",
  data_as_of: "2026-10-11T23:30:00Z",
  fetched_at: "2026-10-12T05:00:00Z",
  note: "",
  periods: [
    {
      label: "Workspace daily rollups",
      basis: "workspace",
      start: "2026-07-14",
      end: "2026-10-11",
      requests: 12,
      tokens: 3456,
      input_tokens: 1234,
      output_tokens: 2222,
      cost_usd: "1.2345",
      models: [{ model: "zen-1", requests: 12, tokens: 3456, cost_usd: "1.2345" }],
    },
  ],
  daily: [
    {
      day: "2026-10-05",
      requests: 3,
      tokens: 300,
      input_tokens: 100,
      output_tokens: 200,
      cache_read_tokens: 50,
      cache_write_tokens: null,
      reasoning_tokens: 0,
      cost_usd: "0.1200",
    },
  ],
  windows: [],
};

const codexRecord = {
  id: "openai-codex",
  status: "available",
  reason: null,
  scope: "account",
  source: "Codex usage buckets",
  data_as_of: "2026-10-11T23:00:00Z",
  fetched_at: "2026-10-12T05:00:00Z",
  note: "",
  periods: [
    {
      label: "Lifetime",
      basis: "lifetime",
      start: null,
      end: null,
      requests: null,
      tokens: null,
      input_tokens: null,
      output_tokens: null,
      cost_usd: null,
      models: [],
    },
  ],
  daily: [
    {
      day: "2026-10-04",
      requests: 7,
      tokens: null,
      input_tokens: null,
      output_tokens: null,
      cache_read_tokens: null,
      cache_write_tokens: null,
      reasoning_tokens: null,
      cost_usd: null,
    },
  ],
  windows: [{ label: "5h window", used_percent: 41.5, reset_at: "2026-10-12T07:00:00Z" }],
};

const ollamaRecord = {
  id: "ollama",
  status: "auth-required",
  reason: "no-credentials",
  scope: "account",
  source: "Ollama Cloud activity",
  data_as_of: null,
  fetched_at: null,
  note: "Ollama Cloud credentials are not available to Quota.",
  periods: [],
  daily: [],
  windows: [],
};

const overviewPayload = {
  ...payload,
  overview: [commandCodeRecord, openCodeRecord, codexRecord, ollamaRecord],
};

test("parses provider history and preserves provider-account scope", () => {
  const history = parseProviderHistory(payload);
  assert.equal(history.scope, "provider-account");
  assert.equal(history.providers[0].supported, true);
  assert.equal(history.providers[1].supported, false);
  assert.equal(history.daily[0].day, "2026-10-10");
  assert.equal(providerMetricValue(history.daily[0], "requests"), 2);
  assert.equal(providerMetricValue(history.daily[0], "tokens"), 72);
  assert.equal(providerMetricValue(history.daily[0], "spend"), 0.0573);
});

test("rejects malformed provider rows instead of plotting fabricated values", () => {
  const malformed = structuredClone(payload);
  malformed.daily[0].requests = -3;
  assert.throws(() => parseProviderHistory(malformed), /invalid provider history/i);

  const malformedCost = structuredClone(payload);
  malformedCost.daily[0].cost_usd = "NaN";
  assert.throws(() => parseProviderHistory(malformedCost), /invalid provider history/i);
});

test("legacy payloads without overview still parse with an empty overview", () => {
  const history = parseProviderHistory(payload);
  assert.deepEqual(history.overview, []);

  const notAnArray = structuredClone(payload) as Record<string, unknown>;
  notAnArray.overview = "nope";
  assert.throws(() => parseProviderHistory(notAnArray), /invalid provider history/i);
});

test("parses additive overview records without touching the legacy contract", () => {
  const history = parseProviderHistory(overviewPayload);
  assert.equal(history.daily.length, 1);
  assert.deepEqual(history.overview.map((record) => record.id), ["commandcode", "opencode-go", "openai-codex", "ollama"]);
  const record = history.overview[0];
  assert.equal(record.status, "summary-only");
  assert.equal(record.scope, "account");
  assert.equal(record.source, "CommandCode summary API");
  assert.equal(record.data_as_of, "2026-10-12");
  assert.equal(record.fetched_at, "2026-10-12T05:00:00Z");
  assert.equal(record.periods[0].requests, 1076);
  assert.equal(record.periods[0].tokens, 157290712);
  assert.equal(record.periods[0].cost_usd, "11.425157022999999");
  assert.equal(overviewMetricChips(record.periods[0]).join(" | "), "1,076 requests | 157M tokens | $11.43");
});

test("summary-only period totals never become dated daily events", () => {
  const history = parseProviderHistory(overviewPayload);
  const commandCode = history.overview.find((record) => record.id === "commandcode");
  assert.ok(commandCode);
  assert.equal(commandCode.daily.length, 0);
  assert.equal(history.daily.length, 1);
  assert.equal(history.daily.filter((row) => row.provider === "commandcode").length, 0);
  assert.deepEqual(overviewDaySequence(history.range.start, history.range.end).filter((day) => day === "2026-10-12"), ["2026-10-12"]);
  assert.equal(commandCode.periods[0].requests, 1076);
});

test("unknown Codex input, output, token and cost metrics stay null", () => {
  const history = parseProviderHistory(overviewPayload);
  const row = history.overview.find((record) => record.id === "openai-codex")!.daily[0];
  assert.equal(row.requests, 7);
  assert.equal(row.tokens, null);
  assert.equal(row.input_tokens, null);
  assert.equal(row.output_tokens, null);
  assert.equal(row.cache_read_tokens, null);
  assert.equal(row.cache_write_tokens, null);
  assert.equal(row.reasoning_tokens, null);
  assert.equal(row.cost_usd, null);
  assert.equal(overviewMetricText(row.tokens, "tokens"), "not reported");
  assert.equal(overviewSpendText(row.cost_usd), "not reported");
  assert.equal(overviewDayValue(row, "tokens"), null);
  assert.equal(overviewDayValue(row, "spend"), null);
});

test("OpenCode records keep requests, tokens and decimal costs", () => {
  const history = parseProviderHistory(overviewPayload);
  const record = history.overview.find((entry) => entry.id === "opencode-go")!;
  assert.equal(record.status, "available");
  assert.equal(record.scope, "workspace");
  const row = record.daily[0];
  assert.equal(row.requests, 3);
  assert.equal(row.tokens, 300);
  assert.equal(row.input_tokens, 100);
  assert.equal(row.output_tokens, 200);
  assert.equal(row.reasoning_tokens, 0);
  assert.equal(row.cost_usd, "0.1200");
  assert.equal(overviewSpendText(row.cost_usd), "$0.12");
  assert.equal(overviewDayValue(row, "requests"), 3);
  assert.equal(overviewDayValue(row, "spend"), 0.12);
  assert.equal(overviewMetricChips(record.periods[0]).join(" | "), "12 requests | 3.5K tokens | $1.23");
});

test("auth-required providers expose no metrics that could read as zero", () => {
  const history = parseProviderHistory(overviewPayload);
  const record = history.overview.find((entry) => entry.id === "ollama")!;
  assert.equal(record.status, "auth-required");
  assert.equal(record.reason, "no-credentials");
  assert.equal(record.data_as_of, null);
  assert.equal(record.periods.length, 0);
  assert.equal(record.daily.length, 0);
  assert.deepEqual(overviewMetricChips({ requests: null, tokens: null, cost_usd: null }), []);
  assert.equal(overviewMetricText(null, "count"), "not reported");
  assert.equal(overviewSpendText(null), "not reported");
});

test("UTC day strings are preserved and day sequences do not drift", () => {
  const history = parseProviderHistory(overviewPayload);
  assert.equal(history.overview.find((entry) => entry.id === "openai-codex")!.daily[0].day, "2026-10-04");
  assert.equal(history.overview.find((entry) => entry.id === "opencode-go")!.daily[0].day, "2026-10-05");
  assert.deepEqual(overviewDaySequence("2026-10-01", "2026-10-04"), ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  assert.deepEqual(overviewDaySequence("2026-03-28", "2026-03-30"), ["2026-03-28", "2026-03-29", "2026-03-30"]);
  assert.deepEqual(overviewDaySequence("2028-02-28", "2028-03-01"), ["2028-02-28", "2028-02-29", "2028-03-01"]);
  assert.deepEqual(overviewDaySequence("2026-10-04", "2026-10-01"), []);
});

test("windows and stamps parse strictly while remaining nullable", () => {
  const history = parseProviderHistory(overviewPayload);
  const window = history.overview.find((entry) => entry.id === "openai-codex")!.windows[0];
  assert.equal(window.label, "5h window");
  assert.equal(window.used_percent, 41.5);
  assert.equal(window.reset_at, "2026-10-12T07:00:00Z");
  const withNulls = structuredClone(overviewPayload);
  withNulls.overview[3].windows = [{ label: "usage", used_percent: null, reset_at: null }];
  assert.equal(parseProviderHistory(withNulls).overview[3].windows[0].used_percent, null);
});

test("desktop-projected daily rows may omit breakdown tokens and still parse as null", () => {
  const projected = structuredClone(overviewPayload);
  projected.overview[1].daily = [
    { day: "2026-10-06", requests: 5, tokens: 900, cost_usd: "0.2500" } as unknown as (typeof projected.overview)[number]["daily"][number],
    {
      day: "2026-10-07",
      requests: 5,
      tokens: 900,
      cost_usd: "0.2500",
      input_tokens: 400,
      output_tokens: 500,
      cache_read_tokens: 0,
      cache_write_tokens: null,
      reasoning_tokens: 25,
    },
  ];
  const history = parseProviderHistory(projected);
  const [omitted, provided] = history.overview[1].daily;
  assert.equal(omitted.day, "2026-10-06");
  assert.equal(omitted.requests, 5);
  assert.equal(omitted.tokens, 900);
  assert.equal(omitted.cost_usd, "0.2500");
  assert.equal(omitted.input_tokens, null);
  assert.equal(omitted.output_tokens, null);
  assert.equal(omitted.cache_read_tokens, null);
  assert.equal(omitted.cache_write_tokens, null);
  assert.equal(omitted.reasoning_tokens, null);
  assert.equal(provided.input_tokens, 400);
  assert.equal(provided.output_tokens, 500);
  assert.equal(provided.cache_read_tokens, 0);
  assert.equal(provided.cache_write_tokens, null);
  assert.equal(provided.reasoning_tokens, 25);
  const invalid = structuredClone(projected);
  invalid.overview[1].daily[1].input_tokens = -4;
  assert.throws(() => parseProviderHistory(invalid), /invalid provider history/i);
});

test("rejects malformed overview rows instead of inventing metrics", () => {
  const cases: ((copy: typeof overviewPayload) => void)[] = [
    (copy) => { copy.overview[0].periods[0].requests = -5; },
    (copy) => { copy.overview[0].periods[0].cost_usd = "NaN"; },
    (copy) => { copy.overview[0].periods[0].cost_usd = 11.42 as unknown as string; },
    (copy) => { copy.overview[1].daily[0].requests = 3.5; },
    (copy) => { copy.overview[1].daily[0].day = "2026-13-40"; },
    (copy) => { copy.overview[0].status = "fine" as never; },
    (copy) => { copy.overview[0].id = ""; },
    (copy) => { copy.overview[2].windows[0].used_percent = Number.NaN; },
    (copy) => { copy.overview[2].data_as_of = "yesterday"; },
    (copy) => { copy.overview[2].periods[0].models[0] = { tokens: 3 } as never; },
    (copy) => { copy.overview[1].periods[0].models = "zen" as never; },
    (copy) => { copy.overview[3].source = ""; },
    (copy) => { copy.overview[1].fetched_at = "2026-10-12 05:00"; },
  ];
  for (const mutate of cases) {
    const copy = structuredClone(overviewPayload);
    mutate(copy);
    assert.throws(() => parseProviderHistory(copy), /invalid provider history/i);
  }
});

test("parses an additive overview breakdown exactly as reported", () => {
  const withBreakdown = structuredClone(overviewPayload) as unknown as {
    overview: ({ breakdown?: unknown } & Record<string, unknown>)[];
  };
  withBreakdown.overview[1].breakdown = {
    tokens: 3456,
    input_tokens: 1234,
    output_tokens: 2222,
    cache_read_tokens: 50,
    cache_write_tokens: null,
    reasoning_tokens: 0,
    requests: 12,
    cost_usd: "1.2345",
    active_days: 1,
    reported_days: 1,
  };
  const history = parseProviderHistory(withBreakdown);
  const value = history.overview[1].breakdown;
  assert.equal(value.tokens, 3456);
  assert.equal(value.input_tokens, 1234);
  assert.equal(value.output_tokens, 2222);
  assert.equal(value.cache_read_tokens, 50);
  assert.equal(value.cache_write_tokens, null);
  assert.equal(value.reasoning_tokens, 0);
  assert.equal(value.requests, 12);
  assert.equal(value.cost_usd, "1.2345");
  assert.equal(value.active_days, 1);
  assert.equal(value.reported_days, 1);
});

test("legacy overview records without a breakdown derive one from dated rows", () => {
  const history = parseProviderHistory(overviewPayload);
  const openCode = history.overview.find((record) => record.id === "opencode-go")!.breakdown;
  assert.equal(openCode.tokens, 300);
  assert.equal(openCode.input_tokens, 100);
  assert.equal(openCode.output_tokens, 200);
  assert.equal(openCode.cache_read_tokens, 50);
  assert.equal(openCode.cache_write_tokens, null);
  assert.equal(openCode.reasoning_tokens, 0);
  assert.equal(openCode.requests, 3);
  assert.equal(openCode.cost_usd, "0.12");
  assert.equal(openCode.active_days, 1);
  assert.equal(openCode.reported_days, 1);

  const codex = history.overview.find((record) => record.id === "openai-codex")!.breakdown;
  assert.equal(codex.requests, 7);
  assert.equal(codex.tokens, null);
  assert.equal(codex.cost_usd, null);
  assert.equal(codex.active_days, 1);
  assert.equal(codex.reported_days, 1);
});

test("summary-only records carry an all-null breakdown with zero day counts", () => {
  const history = parseProviderHistory(overviewPayload);
  const commandCode = history.overview.find((record) => record.id === "commandcode")!.breakdown;
  assert.deepEqual(commandCode, {
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
  });
});

test("rejects malformed breakdown rows instead of inventing metrics", () => {
  const cases: ((entry: Record<string, unknown>) => void)[] = [
    (entry) => { entry.tokens = -5; },
    (entry) => { entry.requests = 1.5; },
    (entry) => { entry.cost_usd = "NaN"; },
    (entry) => { entry.active_days = -1; },
    (entry) => { entry.reported_days = 2.5; },
    (entry) => { entry.active_days = undefined; },
  ];
  for (const mutate of cases) {
    const copy = structuredClone(overviewPayload) as unknown as { overview: ({ breakdown?: unknown } & Record<string, unknown>)[] };
    const entry: Record<string, unknown> = {
      tokens: 1,
      input_tokens: null,
      output_tokens: null,
      cache_read_tokens: null,
      cache_write_tokens: null,
      reasoning_tokens: null,
      requests: 1,
      cost_usd: null,
      active_days: 1,
      reported_days: 1,
    };
    mutate(entry);
    copy.overview[1].breakdown = entry;
    assert.throws(() => parseProviderHistory(copy), /invalid provider history/i);
  }
});

const mixBreakdown = (over: Partial<ProviderBreakdown> = {}): ProviderBreakdown => ({ ...EMPTY_PROVIDER_BREAKDOWN, ...over });

test("token mix shares use the reported total and leave unknown components unset", () => {
  const mix = providerTokenMix(mixBreakdown({ tokens: 1000, input_tokens: 600, output_tokens: 300, cache_write_tokens: 100 }));
  const byKey = new Map(mix.segments.map((segment) => [segment.key, segment]));
  assert.equal(mix.denominator, 1000);
  assert.equal(mix.partial, true);
  assert.equal(mix.reported, 3);
  assert.equal(byKey.get("input_tokens")!.share, 0.6);
  assert.equal(byKey.get("output_tokens")!.share, 0.3);
  assert.equal(byKey.get("cache_write_tokens")!.share, 0.1);
  assert.equal(byKey.get("reasoning_tokens")!.tokens, null);
  assert.equal(byKey.get("reasoning_tokens")!.share, null);
  assert.equal(byKey.get("cache_read_tokens")!.tokens, null);
  assert.equal(byKey.get("cache_read_tokens")!.share, null);
});

test("token mix falls back to the component sum only when every component is reported", () => {
  const complete = providerTokenMix(
    mixBreakdown({ input_tokens: 600, output_tokens: 300, reasoning_tokens: 50, cache_write_tokens: 25, cache_read_tokens: 25 }),
  );
  assert.equal(complete.denominator, 1000);
  assert.equal(complete.partial, false);
  assert.equal(complete.reported, 5);
  const sum = complete.segments.reduce((total, segment) => total + (segment.share ?? 0), 0);
  assert.equal(Math.round(sum * 1000) / 1000, 1);

  // No reported total and a missing component: no honest denominator, so no false percentages.
  const partial = providerTokenMix(mixBreakdown({ input_tokens: 600, output_tokens: 300 }));
  assert.equal(partial.denominator, null);
  assert.equal(partial.partial, true);
  for (const segment of partial.segments) assert.equal(segment.share, null);
  assert.equal(partial.segments.find((segment) => segment.key === "input_tokens")!.tokens, 600);
});

test("token mix reports nothing for a summary-only source with an all-null breakdown", () => {
  const mix = providerTokenMix(EMPTY_PROVIDER_BREAKDOWN);
  assert.equal(mix.denominator, null);
  assert.equal(mix.reported, 0);
  assert.equal(mix.partial, true);
  assert.ok(mix.segments.every((segment) => segment.tokens === null && segment.share === null));
});

test("model rows stay keyed by source and period and drop metric-less entries", () => {
  const rows = providerModelBreakdown(parseProviderHistory(overviewPayload));
  // CommandCode's placeholder { model: "unknown" } row has no metrics, so it is dropped.
  assert.equal(rows.some((row) => row.model === "unknown"), false);
  assert.deepEqual(
    rows.map((row) => [row.source, row.period, row.model]),
    [["opencode-go", "Workspace daily rollups", "zen-1"]],
  );
  assert.equal(rows[0].requests, 12);
  assert.equal(rows[0].tokens, 3456);
  assert.equal(rows[0].cost_usd, "1.2345");
});
