import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateProviderBreakdown,
  aggregateProviderDaily,
  breakdownFromDaily,
  DEFAULT_PROVIDER_SELECTION,
  EMPTY_PROVIDER_BREAKDOWN,
  PROVIDER_WINDOW_DAYS,
  providerHistoryArgs,
  providerTokenMix,
  sumDecimalStrings,
  type OverviewDailyRow,
  type ProviderBreakdown,
} from "../src/provider-history.ts";

const row = (day: string, over: Partial<OverviewDailyRow> = {}): OverviewDailyRow => ({
  day,
  requests: null,
  tokens: null,
  input_tokens: null,
  output_tokens: null,
  cache_read_tokens: null,
  cache_write_tokens: null,
  reasoning_tokens: null,
  cost_usd: null,
  ...over,
});

const breakdown = (over: Partial<ProviderBreakdown> = {}): ProviderBreakdown => ({
  ...EMPTY_PROVIDER_BREAKDOWN,
  ...over,
});

test("combined annual view sums overlapping provider days", () => {
  const sources = [
    { id: "a", daily: [row("2026-01-02", { requests: 3, tokens: 300, cost_usd: "0.1200" })] },
    { id: "b", daily: [row("2026-01-02", { requests: 4, tokens: 400, cost_usd: "0.0800" })] },
  ];
  const agg = aggregateProviderDaily(sources, "2026-01-01", "2026-01-03");
  const shared = agg.find((entry) => entry.day === "2026-01-02")!;
  assert.equal(shared.requests, 7);
  assert.equal(shared.tokens, 700);
  assert.equal(shared.cost_usd, "0.2");
  assert.deepEqual(shared.coverage, { reported: 2, expected: 2 });

  const silent = agg.find((entry) => entry.day === "2026-01-01")!;
  assert.equal(silent.requests, null);
  assert.equal(silent.tokens, null);
  assert.equal(silent.cost_usd, null);
  assert.deepEqual(silent.coverage, { reported: 0, expected: 2 });
});

test("missing provider metrics stay null instead of reading as zero", () => {
  const sources = [
    { id: "codex", daily: [row("2026-02-01", { requests: 7 })] },
    { id: "opencode", daily: [row("2026-02-01", { tokens: 500, cost_usd: "1.0000" })] },
  ];
  const day = aggregateProviderDaily(sources, "2026-02-01", "2026-02-01")[0];
  assert.equal(day.requests, 7);
  assert.equal(day.tokens, 500);
  assert.equal(day.input_tokens, null);
  assert.equal(day.cost_usd, "1");
  assert.deepEqual(day.coverage, { reported: 2, expected: 2 });
  assert.deepEqual(day.metricCoverage.requests, { reported: 1, expected: 2 });
  assert.deepEqual(day.metricCoverage.tokens, { reported: 1, expected: 2 });
  assert.deepEqual(day.metricCoverage.spend, { reported: 1, expected: 2 });
});

test("a lone source reporting a null metric never fabricates a zero aggregate", () => {
  const sources = [{ id: "codex", daily: [row("2026-02-02", { requests: 2 })] }];
  const day = aggregateProviderDaily(sources, "2026-02-02", "2026-02-02")[0];
  assert.equal(day.requests, 2);
  assert.equal(day.tokens, null);
  assert.equal(day.output_tokens, null);
  assert.equal(day.cost_usd, null);
  assert.deepEqual(day.coverage, { reported: 1, expected: 1 });
});

test("summary-only sources are excluded from the combined timeline", () => {
  const sources = [
    { id: "commandcode", daily: [] },
    { id: "opencode", daily: [row("2026-03-01", { tokens: 10 })] },
  ];
  const agg = aggregateProviderDaily(sources, "2026-03-01", "2026-03-01");
  assert.equal(agg.length, 1);
  assert.equal(agg[0].tokens, 10);
  assert.deepEqual(agg[0].coverage, { reported: 1, expected: 1 });
});

test("decimal costs add exactly without float drift", () => {
  assert.equal(sumDecimalStrings(["0.1", "0.2"]), "0.3");
  assert.equal(sumDecimalStrings(["11.425157022999999", "0.12"]), "11.545157022999999");
  assert.equal(sumDecimalStrings(["0", "0.1200"]), "0.12");
  assert.equal(sumDecimalStrings([]), null);

  const sources = [
    { id: "a", daily: [row("2026-04-01", { cost_usd: "0.1" })] },
    { id: "b", daily: [row("2026-04-01", { cost_usd: "0.2" })] },
  ];
  const day = aggregateProviderDaily(sources, "2026-04-01", "2026-04-01")[0];
  assert.equal(day.cost_usd, "0.3");
});

test("combined series spans exactly one UTC day per calendar day of the annual window", () => {
  const sources = [{ id: "opencode", daily: [row("2026-06-15", { tokens: 5 })] }];
  const annual = aggregateProviderDaily(sources, "2025-09-26", "2026-09-25");
  assert.equal(annual.length, 365);
  assert.equal(annual[0].day, "2025-09-26");
  assert.equal(annual[annual.length - 1].day, "2026-09-25");
  assert.equal(
    annual.every((entry, index) => index === 0 || entry.day > annual[index - 1].day),
    true,
  );

  const leap = aggregateProviderDaily(sources, "2028-01-01", "2028-12-31");
  assert.equal(leap.length, 366);
  assert.equal(leap[59].day, "2028-02-29");
});

test("provider view defaults to all sources on a fixed annual window", () => {
  assert.equal(PROVIDER_WINDOW_DAYS, 365);
  assert.equal(DEFAULT_PROVIDER_SELECTION, "all");
  assert.deepEqual(providerHistoryArgs("cached"), ["provider-history", "--days", "365", "--desktop"]);
  assert.deepEqual(providerHistoryArgs("refresh"), ["provider-history", "--days", "365", "--desktop", "--refresh"]);
  assert.equal(providerHistoryArgs("cached").includes("--refresh"), false);
  assert.equal(providerHistoryArgs("cached")[0], "provider-history");
  assert.equal(providerHistoryArgs("refresh").includes("--refresh"), true);
  assert.equal(providerHistoryArgs("refresh").includes("--days"), true);
});

test("summary-only sources never enter the combined token mix denominator", () => {
  const sources = [
    { id: "commandcode", breakdown: breakdown({ tokens: 1000, cost_usd: "9.0" }), daily: [] },
    { id: "openai-codex", breakdown: breakdown({ tokens: 900, input_tokens: 400, output_tokens: 500 }), daily: [row("2026-01-02", { tokens: 900, input_tokens: 400, output_tokens: 500 })] },
  ];
  const agg = aggregateProviderBreakdown(sources, "2026-01-01", "2026-01-03");
  assert.equal(agg.contributors, 1);
  const mix = providerTokenMix(agg.breakdown);
  assert.equal(mix.denominator, 900);
  const input = mix.segments.find((segment) => segment.key === "input_tokens")!;
  const output = mix.segments.find((segment) => segment.key === "output_tokens")!;
  assert.equal(input.share, 400 / 900);
  assert.equal(output.share, 500 / 900);
  // The summary-only source's 1000-token total is excluded, so its tokens never inflate the
  // denominator and the shares stay honest.
  assert.equal(mix.denominator === 1900, false);
});

test("combined breakdown sums only dated sources and stays null when nothing is reported", () => {
  const sources = [
    { id: "openai-codex", breakdown: breakdown({ tokens: 900, requests: 7 }), daily: [row("2026-01-02", { tokens: 900, requests: 7 })] },
    { id: "commandcode", breakdown: breakdown({ tokens: 1000, cost_usd: "9.0" }), daily: [] },
    { id: "opencode-go", breakdown: breakdown({ input_tokens: 100, output_tokens: 200, cost_usd: "0.1" }), daily: [row("2026-01-02", { input_tokens: 100, output_tokens: 200, cost_usd: "0.1" })] },
  ];
  const agg = aggregateProviderBreakdown(sources, "2026-01-01", "2026-01-03");
  assert.equal(agg.contributors, 2);
  assert.equal(agg.breakdown.tokens, 900);
  assert.equal(agg.breakdown.requests, 7);
  assert.equal(agg.breakdown.input_tokens, 100);
  assert.equal(agg.breakdown.output_tokens, 200);
  assert.equal(agg.breakdown.cache_read_tokens, null);
  assert.equal(agg.breakdown.cache_write_tokens, null);
  assert.equal(agg.breakdown.reasoning_tokens, null);
  assert.equal(agg.breakdown.cost_usd, "0.1");
  assert.equal(agg.breakdown.active_days, 1);
  assert.equal(agg.breakdown.reported_days, 1);
  assert.deepEqual(agg.metricCoverage.tokens, { reported: 1, expected: 2 });
  assert.deepEqual(agg.metricCoverage.spend, { reported: 1, expected: 2 });
});

test("combined breakdown adds reported spend exactly without float drift", () => {
  const agg = aggregateProviderBreakdown(
    [
      { id: "a", breakdown: breakdown({ cost_usd: "0.1" }), daily: [row("2026-04-01", { cost_usd: "0.1" })] },
      { id: "b", breakdown: breakdown({ cost_usd: "0.2" }), daily: [row("2026-04-02", { cost_usd: "0.2" })] },
      { id: "c", breakdown: breakdown({ cost_usd: "11.425157022999999" }), daily: [row("2026-04-03", { cost_usd: "11.425157022999999" })] },
    ],
    "2026-04-01",
    "2026-04-30",
  );
  assert.equal(agg.breakdown.cost_usd, "11.725157022999999");
});

test("combined active days union dated rows instead of summing per-source counts", () => {
  const sources = [
    { id: "a", breakdown: breakdown({ active_days: 2 }), daily: [row("2026-05-01", { tokens: 1 }), row("2026-05-02", { tokens: 1 })] },
    { id: "b", breakdown: breakdown({ active_days: 2 }), daily: [row("2026-05-02", { tokens: 1 }), row("2026-05-03", { tokens: 1 })] },
  ];
  const agg = aggregateProviderBreakdown(sources, "2026-05-01", "2026-05-31");
  assert.equal(agg.breakdown.active_days, 3);
  assert.equal(agg.breakdown.reported_days, 3);
});

test("combined breakdown ignores dated rows outside the requested window", () => {
  const sources = [
    { id: "a", breakdown: breakdown({ tokens: 10 }), daily: [row("2025-01-05", { tokens: 10 }), row("2026-06-10", { tokens: 10 })] },
  ];
  const agg = aggregateProviderBreakdown(sources, "2026-01-01", "2026-12-31");
  assert.equal(agg.breakdown.active_days, 1);
  assert.equal(agg.breakdown.reported_days, 1);
});

test("an empty provider set yields null metrics with zero day counts", () => {
  const agg = aggregateProviderBreakdown([], "2026-01-01", "2026-01-31");
  assert.deepEqual(agg.breakdown, EMPTY_PROVIDER_BREAKDOWN);
  assert.equal(agg.contributors, 0);
  assert.deepEqual(agg.metricCoverage.tokens, { reported: 0, expected: 0 });
});

test("breakdownFromDaily derives metrics and day counts from dated rows", () => {
  const daily = [
    row("2026-02-01", { requests: 2, tokens: 100, input_tokens: 40, output_tokens: 60, cost_usd: "0.1200" }),
    row("2026-02-02", { requests: 1, tokens: 50, input_tokens: 20, output_tokens: 30, cost_usd: "0.0800" }),
    row("2026-02-03", {}),
  ];
  const derived = breakdownFromDaily(daily);
  assert.equal(derived.requests, 3);
  assert.equal(derived.tokens, 150);
  assert.equal(derived.input_tokens, 60);
  assert.equal(derived.output_tokens, 90);
  assert.equal(derived.cache_read_tokens, null);
  assert.equal(derived.reasoning_tokens, null);
  assert.equal(derived.cost_usd, "0.2");
  assert.equal(derived.active_days, 2);
  assert.equal(derived.reported_days, 3);
  assert.deepEqual(breakdownFromDaily([]), EMPTY_PROVIDER_BREAKDOWN);
});
