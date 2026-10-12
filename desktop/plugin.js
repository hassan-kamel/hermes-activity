import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { Codicon, host, PALETTE_AREA, ROUTES_AREA, SegmentedControl, SIDEBAR_NAV_AREA, Skeleton, STATUSBAR_AREAS, useQuery, useQueryClient, useValue, } from "@hermes/plugin-sdk";
const OVERVIEW_STATUSES = ["available", "summary-only", "auth-required", "unavailable", "not-collected", "not-integrated"];
const EMPTY_PROVIDER_BREAKDOWN = {
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
const BREAKDOWN_SUM_METRICS = [
    "requests",
    "tokens",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "reasoning_tokens",
];
function dayIsActive(row) {
    return BREAKDOWN_SUM_METRICS.some((metric) => (row[metric] ?? 0) > 0) ||
        (row.cost_usd !== null && Number(row.cost_usd) > 0);
}
function breakdownFromDaily(daily) {
    const breakdown = { ...EMPTY_PROVIDER_BREAKDOWN, reported_days: daily.length };
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
    breakdown.cost_usd = sumDecimalStrings(daily.map((row) => row.cost_usd).filter((cost) => cost !== null));
    breakdown.active_days = daily.filter(dayIsActive).length;
    return breakdown;
}
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isDay(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function isTimestamp(value) {
    return typeof value === "string" && TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}
function nonnegativeInteger(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function invalid(part) {
    throw new Error(`Invalid provider history ${part}`);
}
function requiredText(value) {
    if (typeof value === "string" && value.trim() !== "")
        return value;
    return invalid("overview text");
}
function nullableText(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "string")
        return value;
    return invalid("overview text");
}
function noteText(value) {
    if (value === null || value === undefined)
        return "";
    if (typeof value === "string")
        return value;
    return invalid("overview note");
}
function nullableInteger(value) {
    if (value === null || value === undefined)
        return null;
    if (nonnegativeInteger(value))
        return value;
    return invalid("overview metric");
}
function nullableDecimal(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "string" && DECIMAL.test(value))
        return value;
    return invalid("overview cost");
}
function nullableStamp(value) {
    if (value === null || value === undefined)
        return null;
    if (isDay(value) || isTimestamp(value))
        return value;
    return invalid("overview timestamp");
}
function nullablePercent(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    return invalid("overview window");
}
function parseOverviewPeriodModel(entry) {
    if (!isRecord(entry))
        return invalid("overview model");
    return {
        model: requiredText(entry.model),
        requests: nullableInteger(entry.requests),
        tokens: nullableInteger(entry.tokens),
        cost_usd: nullableDecimal(entry.cost_usd),
    };
}
function parseOverviewPeriod(entry) {
    if (!isRecord(entry) || !Array.isArray(entry.models))
        return invalid("overview period");
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
function parseOverviewDailyRow(entry) {
    if (!isRecord(entry) || !isDay(entry.day))
        return invalid("overview daily row");
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
function parseOverviewWindow(entry) {
    if (!isRecord(entry))
        return invalid("overview window");
    return {
        label: requiredText(entry.label),
        used_percent: nullablePercent(entry.used_percent),
        reset_at: nullableText(entry.reset_at),
    };
}
function parseProviderBreakdown(entry) {
    if (!isRecord(entry))
        return invalid("overview breakdown");
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
function parseProviderOverview(entry) {
    if (!isRecord(entry) || !Array.isArray(entry.periods) || !Array.isArray(entry.daily) || !Array.isArray(entry.windows)) {
        return invalid("overview provider");
    }
    if (typeof entry.status !== "string" || !OVERVIEW_STATUSES.includes(entry.status)) {
        return invalid("overview status");
    }
    const daily = entry.daily.map(parseOverviewDailyRow);
    return {
        id: requiredText(entry.id),
        status: entry.status,
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
function parseProviderHistory(value) {
    if (!isRecord(value) || value.schema_version !== 1 || value.scope !== "provider-account" ||
        !isRecord(value.range) || !isDay(value.range.start) || !isDay(value.range.end) ||
        !nonnegativeInteger(value.range.days) || value.range.days < 1 || value.range.days > 365 ||
        typeof value.provider_filter !== "string" || !Array.isArray(value.providers) || !Array.isArray(value.daily)) {
        throw new Error("Invalid provider history payload");
    }
    const providers = value.providers.map((entry) => {
        if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id ||
            typeof entry.supported !== "boolean" || typeof entry.has_history !== "boolean") {
            throw new Error("Invalid provider history provider status");
        }
        return { id: entry.id, supported: entry.supported, has_history: entry.has_history };
    });
    const daily = value.daily.map((entry) => {
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
    let overview = [];
    if (value.overview !== undefined && value.overview !== null) {
        if (!Array.isArray(value.overview))
            throw new Error("Invalid provider history overview");
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
function providerMetricValue(row, metric) {
    if (metric === "requests")
        return row.requests;
    if (metric === "tokens")
        return row.tokens;
    const cost = row.cost_usd === null ? 0 : Number(row.cost_usd);
    return Number.isFinite(cost) ? cost : 0;
}
function compactOverviewNumber(value) {
    const abs = Math.abs(value);
    if (abs >= 1e9)
        return `${(value / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
    if (abs >= 1e6)
        return `${(value / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
    if (abs >= 1e3)
        return `${(value / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
    return String(Math.round(value));
}
function overviewMetricText(value, kind) {
    if (value === null || !Number.isFinite(value))
        return "not reported";
    return kind === "tokens" ? compactOverviewNumber(value) : Math.round(value).toLocaleString("en-US");
}
function overviewSpendText(cost_usd) {
    if (cost_usd === null)
        return "not reported";
    const amount = Number(cost_usd);
    if (!Number.isFinite(amount))
        return "not reported";
    if (amount > 0 && amount < 0.01)
        return "<$0.01";
    return `${amount.toFixed(2)}`;
}
function overviewMetricChips(metrics) {
    const chips = [];
    if (metrics.requests !== null && metrics.requests !== undefined) {
        chips.push(`${overviewMetricText(metrics.requests, "count")} requests`);
    }
    if (metrics.tokens !== null && metrics.tokens !== undefined) {
        chips.push(`${overviewMetricText(metrics.tokens, "tokens")} tokens`);
    }
    else {
        if (metrics.input_tokens !== null && metrics.input_tokens !== undefined) {
            chips.push(`${overviewMetricText(metrics.input_tokens, "tokens")} input`);
        }
        if (metrics.output_tokens !== null && metrics.output_tokens !== undefined) {
            chips.push(`${overviewMetricText(metrics.output_tokens, "tokens")} output`);
        }
    }
    if (metrics.cost_usd !== null && metrics.cost_usd !== undefined)
        chips.push(overviewSpendText(metrics.cost_usd));
    return chips;
}
function overviewDayValue(row, metric) {
    if (metric === "requests")
        return row.requests;
    if (metric === "tokens")
        return row.tokens;
    if (row.cost_usd === null)
        return null;
    const amount = Number(row.cost_usd);
    return Number.isFinite(amount) ? amount : null;
}
function overviewDaySequence(start, end) {
    const startMs = isDay(start) ? Date.parse(`${start}T00:00:00Z`) : Number.NaN;
    const endMs = isDay(end) ? Date.parse(`${end}T00:00:00Z`) : Number.NaN;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs)
        return [];
    const days = [];
    for (let time = startMs; time <= endMs; time += 86_400_000) {
        days.push(new Date(time).toISOString().slice(0, 10));
    }
    return days;
}
// ───────────────────────────────────────────────────────────── annual provider window
// Providers always render a fixed rolling annual (365-day / 12-month) timeline, so the
// range control is intentionally not user-selectable here.
const PROVIDER_WINDOW_DAYS = 365;
// The provider filter always starts on the combined "all" view; a previously persisted
// single-provider selection is deliberately ignored on mount.
const DEFAULT_PROVIDER_SELECTION = "all";
function providerHistoryArgs(mode = "cached", days = PROVIDER_WINDOW_DAYS) {
    return ["provider-history", "--days", String(days), "--desktop", ...(mode === "refresh" ? ["--refresh"] : [])];
}
/** Exact decimal-string addition (no float drift), e.g. "0.1" + "0.2" === "0.3". */
function sumDecimalStrings(values) {
    const cleaned = values.filter((value) => DECIMAL.test(value));
    if (!cleaned.length)
        return null;
    let scale = 0;
    for (const value of cleaned) {
        const fraction = value.includes(".") ? value.split(".")[1].length : 0;
        if (fraction > scale)
            scale = fraction;
    }
    let total = 0n;
    for (const value of cleaned) {
        const [whole, fraction = ""] = value.split(".");
        total += BigInt(whole + fraction.padEnd(scale, "0"));
    }
    if (scale === 0)
        return total.toString();
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
function aggregateProviderDaily(sources, start, end) {
    const contributors = sources.filter((source) => source.daily.length > 0);
    const expected = contributors.length;
    const byDay = new Map();
    for (const source of contributors) {
        for (const row of source.daily) {
            const rows = byDay.get(row.day);
            if (rows)
                rows.push(row);
            else
                byDay.set(row.day, [row]);
        }
    }
    return overviewDaySequence(start, end).map((day) => {
        const rows = byDay.get(day) ?? [];
        const sum = (pick) => {
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
        const row = {
            day,
            requests: null,
            tokens: null,
            input_tokens: null,
            output_tokens: null,
            cache_read_tokens: null,
            cache_write_tokens: null,
            reasoning_tokens: null,
            cost_usd: sumDecimalStrings(rows.map((entry) => entry.cost_usd).filter((cost) => cost !== null)),
            coverage: { reported: rows.length, expected },
            metricCoverage: {
                requests: { reported: rows.filter((entry) => entry.requests !== null).length, expected },
                tokens: { reported: rows.filter((entry) => entry.tokens !== null).length, expected },
                spend: { reported: rows.filter((entry) => entry.cost_usd !== null).length, expected },
            },
        };
        for (const metric of BREAKDOWN_SUM_METRICS)
            row[metric] = sum((entry) => entry[metric]);
        return row;
    });
}
function aggregateProviderBreakdown(sources, start, end) {
    const contributors = sources.filter((source) => source.daily.length > 0);
    const expected = contributors.length;
    const sumMetric = (metric) => {
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
    const activeDays = new Set();
    const reportedDays = new Set();
    for (const source of contributors) {
        for (const row of source.daily) {
            if (row.day < start || row.day > end)
                continue;
            reportedDays.add(row.day);
            if (dayIsActive(row))
                activeDays.add(row.day);
        }
    }
    const metricCoverage = {};
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
            cost_usd: sumDecimalStrings(contributors.map((source) => source.breakdown.cost_usd).filter((cost) => cost !== null)),
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
const TOKEN_MIX_KEYS = [
    "input_tokens",
    "output_tokens",
    "reasoning_tokens",
    "cache_write_tokens",
    "cache_read_tokens",
];
/**
 * Builds the provider token mix without inventing shares.
 *
 * The denominator is the source's own reported `tokens` total when present (the honest
 * base for a mix: components are subsets of the total), otherwise the sum of the
 * components, but ONLY when every component is reported. If some components are missing
 * and no total is reported, no denominator exists and every share stays null so a partial
 * sum can never masquerade as a full 100%.
 */
function providerTokenMix(breakdown) {
    const values = TOKEN_MIX_KEYS.map((key) => breakdown[key]);
    const reported = values.filter((value) => value !== null).length;
    const allReported = reported === TOKEN_MIX_KEYS.length;
    let denominator = breakdown.tokens;
    if (denominator === null && allReported) {
        denominator = values.reduce((sum, value) => sum + value, 0);
    }
    const segments = TOKEN_MIX_KEYS.map((key, index) => {
        const tokens = values[index];
        let share = null;
        if (denominator !== null && tokens !== null) {
            share = denominator > 0 ? tokens / denominator : 0;
        }
        return { key, tokens, share };
    });
    return { segments, denominator, reported, partial: !allReported || denominator === null };
}
/**
 * Enumerates each source's per-period model rows.
 *
 * Rows are keyed by (source, period, model) and are NEVER summed across periods: a
 * provider's "Lifetime" or "Last 30 days" model totals stay attached to their own period
 * and are never folded into the annual window or into one another. Model entries with no
 * reported metric are dropped as noise (they carry no data).
 */
function providerModelBreakdown(history) {
    const rows = [];
    for (const record of history.overview) {
        for (const period of record.periods) {
            for (const model of period.models) {
                if (model.requests === null && model.tokens === null && model.cost_usd === null)
                    continue;
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

import { useEffect, useMemo, useRef, useState } from "react";
const ID = "hermes-activity";
const ROUTE = "/activity";
const WIDGET_VERSION = "0.2.0"; // must equal plugin.yaml `version`
const CLI_TIMEOUT_MS = 60_000;
// ───────────────────────────────────────────────────────────── formatting
const tokensOf = (s) => s.input_tokens + s.output_tokens + s.cache_read_tokens + s.cache_write_tokens + s.reasoning_tokens;
function compact(n) {
    if (!Number.isFinite(n))
        return "0";
    const abs = Math.abs(n);
    if (abs >= 1e9)
        return `${(n / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
    if (abs >= 1e6)
        return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
    if (abs >= 1e3)
        return `${(n / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
    return String(Math.round(n));
}
const money = (n) => (n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
const pad = (n) => String(n).padStart(2, "0");
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const prettyDay = (iso) => {
    const d = parseDay(iso);
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};
const plural = (n, one, many = `${one}s`) => `${compact(n)} ${n === 1 ? one : many}`;
const METRICS = [
    { id: "tokens", label: "Tokens" },
    { id: "sessions", label: "Sessions" },
    { id: "messages", label: "Messages" },
    { id: "tool_calls", label: "Tool calls" },
];
const metricValue = (row, m) => !row ? 0 : m === "tokens" ? tokensOf(row) : m === "sessions" ? row.sessions + row.subagent_sessions : row[m];
const metricLabel = (v, m) => m === "tokens"
    ? plural(v, "token")
    : m === "sessions"
        ? plural(v, "session")
        : m === "messages"
            ? plural(v, "message")
            : plural(v, "tool call");
// ───────────────────────────────────────────────────────────── data path (cli.exec)
let CTX = null;
function scopeOf(owner) {
    const connectionId = String(owner?.connectionId || "").trim();
    const profile = String(owner?.profile || "").trim();
    return connectionId && profile ? { connectionId, profile } : null;
}
async function resolveRoute(scope) {
    const routes = await host.profileRoutes();
    const exact = scope ? routes.filter((r) => r.connectionId === scope.connectionId && r.profile === scope.profile) : [];
    if (exact.length === 1)
        return exact[0];
    // No focused chat (or it's ambiguous): fall back to the desktop's primary local route.
    const fallback = routes.find((r) => r.primary) ?? routes.find((r) => r.mode === "local") ?? routes[0];
    if (!fallback)
        throw new Error("No Hermes profile route available");
    return fallback;
}
/** cli.exec joins stdout+stderr; pick the last line that parses as a JSON object. */
function parseCliJson(output) {
    const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].startsWith("{"))
            continue;
        try {
            return JSON.parse(lines[i]);
        }
        catch {
            /* keep looking */
        }
    }
    throw new Error(output.trim().split("\n").slice(-3).join(" ") || "empty output from hermes activity");
}
async function profileCli(scope, command, argv) {
    const route = await resolveRoute(scope);
    const res = await host.requestProfile(route, "cli.exec", { argv: ["--profile", route.targetProfile, command, ...argv, "--json"], timeout: CLI_TIMEOUT_MS / 1000 }, CLI_TIMEOUT_MS + 5_000);
    if (res.blocked)
        throw new Error(res.hint || "cli.exec blocked");
    const payload = parseCliJson(res.output || "");
    if (payload.error)
        throw new Error(payload.error);
    return payload;
}
async function activityCli(scope, argv) {
    return profileCli(scope, "activity", argv);
}
function useScope() {
    const owner = useValue(host.state.focusedSessionOwner);
    const scope = scopeOf(owner);
    return { scope, key: scope ? `${scope.connectionId}::${scope.profile}` : "primary" };
}
/** Invalidate our queries when a turn finishes, so numbers stay current without polling. */
function useRefreshOnTurnEnd(prefix) {
    const busy = useValue(host.state.busy);
    const qc = useQueryClient();
    const was = useRef(busy);
    useEffect(() => {
        if (was.current && !busy)
            void qc.invalidateQueries({ queryKey: prefix });
        was.current = busy;
    }, [busy, qc, prefix]);
}
// ───────────────────────────────────────────────────────────── small UI atoms (Usage-panel styling)
const LABEL = "text-[0.625rem] font-medium uppercase tracking-[0.08em] text-(--ui-text-tertiary)";
const CAPTION = "text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)";
const TEXT = "text-[length:var(--conversation-text-font-size)] text-foreground";
function Stat({ label, value, hint }) {
    return (_jsxs("div", { className: "min-w-0", children: [_jsx("div", { className: "text-[0.625rem] font-medium uppercase tracking-[0.12em] text-(--ui-text-tertiary)", children: label }), _jsx("div", { className: "mt-1 truncate text-base font-semibold tracking-tight text-foreground", title: value, children: value }), hint && _jsx("div", { className: "mt-0.5 truncate text-[0.62rem] text-(--ui-text-tertiary)", children: hint })] }));
}
function Section({ title, trailing, children }) {
    return (_jsxs("section", { className: "min-w-0", children: [_jsxs("div", { className: "mb-2 flex items-center justify-between gap-3", children: [_jsx("span", { className: LABEL, children: title }), trailing] }), children] }));
}
function List({ rows, empty }) {
    if (!rows.length)
        return _jsx("div", { className: CAPTION, children: empty });
    return (_jsx("ul", { children: rows.map((r) => (_jsxs("li", { className: "flex items-center justify-between gap-2 py-1.5", children: [_jsx("span", { className: "min-w-0 truncate font-mono text-[0.7rem] text-foreground", title: r.label, children: r.label }), _jsxs("span", { className: "shrink-0 text-[0.7rem] text-(--ui-text-tertiary)", children: [r.value, r.hint ? ` · ${r.hint}` : ""] })] }, r.key))) }));
}
function IconButton({ label, icon, onClick, spinning }) {
    return (_jsx("button", { "aria-label": label, className: "inline-flex size-6 items-center justify-center rounded text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground", onClick: onClick, title: label, type: "button", children: _jsx(Codicon, { name: icon, spinning: spinning }) }));
}
/** Theme-derived cell colour. Level 0 is a faint wash of the text colour. */
const levelColor = (level) => level === 0
    ? "color-mix(in srgb, currentColor 9%, transparent)"
    : `color-mix(in srgb, var(--ui-accent) ${[0, 30, 52, 76, 100][level]}%, transparent)`;
// ───────────────────────────────────────────────────────────── contribution grid
const CELL = 11;
const GAP = 3;
function ContributionGrid({ data, metric, start, end, selected, onSelect, }) {
    const wrap = useRef(null);
    const [tip, setTip] = useState(null);
    const model = useMemo(() => {
        const byDay = new Map(data.map((d) => [d.day, d]));
        const first = parseDay(start);
        const last = parseDay(end);
        // Columns are Sunday-first weeks, cropped to the range (so 30d isn't a mostly blank year).
        const gridStart = new Date(first);
        gridStart.setDate(first.getDate() - first.getDay());
        const weeks = Math.ceil(((last.getTime() - gridStart.getTime()) / 86_400_000 + 1) / 7);
        const values = data.map((d) => metricValue(d, metric)).filter((v) => v > 0).sort((a, b) => a - b);
        const q = (p) => values[Math.min(values.length - 1, Math.floor(p * values.length))] ?? 0;
        const th = [q(0.25), q(0.5), q(0.75)];
        const level = (v) => (v <= 0 ? 0 : v <= th[0] ? 1 : v <= th[1] ? 2 : v <= th[2] ? 3 : 4);
        const cols = [];
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
        if (cols[0]?.month && (cols[1]?.month || cols[2]?.month))
            cols[0].month = "";
        return cols;
    }, [data, metric, start, end]);
    const show = (el) => {
        const day = el.dataset.day;
        if (!day || !wrap.current)
            return;
        const box = wrap.current.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        setTip({
            text: `${metricLabel(Number(el.dataset.v), metric)} on ${prettyDay(day)}`,
            x: r.left - box.left + r.width / 2 + wrap.current.scrollLeft,
            y: r.top - box.top,
        });
    };
    const labelCol = { display: "grid", gridTemplateRows: `14px repeat(7, ${CELL}px)`, gap: GAP, marginRight: 6 };
    return (_jsxs("div", { className: "relative overflow-x-auto pb-1", ref: wrap, onMouseLeave: () => setTip(null), children: [_jsxs("div", { style: { display: "flex", width: "max-content" }, children: [_jsxs("div", { "aria-hidden": true, style: labelCol, children: [_jsx("span", {}), WEEKDAYS.map((d, i) => (_jsx("span", { className: "text-[0.6rem] leading-[11px] text-(--ui-text-tertiary)", children: i % 2 === 1 ? d : "" }, d)))] }), _jsx("div", { role: "grid", "aria-label": "Activity by day", style: { display: "grid", gridAutoFlow: "column", gridTemplateRows: `14px repeat(7, ${CELL}px)`, gridAutoColumns: CELL, gap: GAP }, onMouseOver: (e) => {
                            const el = e.target.closest("[data-day]");
                            if (el)
                                show(el);
                        }, onFocus: (e) => {
                            const el = e.target.closest("[data-day]");
                            if (el)
                                show(el);
                        }, onClick: (e) => {
                            const el = e.target.closest("[data-day]");
                            if (el?.dataset.day)
                                onSelect(selected === el.dataset.day ? null : el.dataset.day);
                        }, onKeyDown: (e) => {
                            const el = e.target.closest("[data-day]");
                            if (el?.dataset.day && (e.key === "Enter" || e.key === " ")) {
                                e.preventDefault();
                                onSelect(selected === el.dataset.day ? null : el.dataset.day);
                            }
                        }, children: model.map((col, ci) => [
                            _jsx("span", { className: "overflow-visible whitespace-nowrap text-[0.6rem] leading-[14px] text-(--ui-text-tertiary)", children: col.month }, `m${ci}`),
                            ...col.cells.map((c) => c.out ? (_jsx("span", {}, c.day)) : (_jsx("span", { "aria-label": `${metricLabel(c.v, metric)} on ${prettyDay(c.day)}`, "aria-selected": selected === c.day, "data-day": c.day, "data-v": c.v, role: "gridcell", style: {
                                    width: CELL,
                                    height: CELL,
                                    borderRadius: 2,
                                    background: levelColor(c.level),
                                    cursor: "pointer",
                                    outline: selected === c.day ? "1px solid var(--ui-text-primary, currentColor)" : undefined,
                                    outlineOffset: 1,
                                }, tabIndex: 0 }, c.day))),
                        ]) })] }), tip && (_jsx("div", { className: "pointer-events-none absolute z-10 whitespace-nowrap rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) px-2 py-1 text-[0.68rem] text-foreground shadow-md", style: { left: tip.x, top: tip.y - 6, transform: "translate(-50%, -100%)" }, children: tip.text }))] }));
}
function Legend() {
    return (_jsxs("span", { className: "inline-flex items-center gap-1 text-[0.6rem] text-(--ui-text-tertiary)", children: ["Less", [0, 1, 2, 3, 4].map((l) => (_jsx("span", { style: { width: CELL, height: CELL, borderRadius: 2, background: levelColor(l) } }, l))), "More"] }));
}
// ───────────────────────────────────────────────────────────── other visualisations
/**
 * Shared, semantic token-mix palette (theme variables only, no hard-coded colours), so the
 * Hermes tab and the provider tab render the same series identically.
 */
const MIX_COLORS = {
    input_tokens: "var(--ui-blue, var(--ui-accent))",
    output_tokens: "var(--ui-accent)",
    reasoning_tokens: "var(--ui-purple, var(--ui-accent-secondary))",
    cache_write_tokens: "var(--ui-yellow, var(--ui-warm))",
    cache_read_tokens: "color-mix(in srgb, currentColor 22%, transparent)",
};
const TOKEN_MIX_LABELS = {
    input_tokens: "Input",
    output_tokens: "Output",
    reasoning_tokens: "Reasoning",
    cache_write_tokens: "Cache write",
    cache_read_tokens: "Cache read",
};
function TokenMix({ t }) {
    const parts = [
        { key: "input_tokens", v: t.input_tokens },
        { key: "output_tokens", v: t.output_tokens },
        { key: "reasoning_tokens", v: t.reasoning_tokens },
        { key: "cache_write_tokens", v: t.cache_write_tokens },
        { key: "cache_read_tokens", v: t.cache_read_tokens },
    ];
    const sum = parts.reduce((a, p) => a + p.v, 0) || 1;
    return (_jsxs("div", { children: [_jsx("div", { className: "flex h-2 overflow-hidden rounded-full", style: { background: levelColor(0) }, children: parts.map((p) => (p.v > 0 ? _jsx("span", { style: { width: `${(p.v / sum) * 100}%`, background: MIX_COLORS[p.key] } }, p.key) : null)) }), _jsx("ul", { className: "mt-2", children: parts.map((p) => (_jsxs("li", { className: "flex items-center justify-between gap-2 py-1", children: [_jsxs("span", { className: "inline-flex items-center gap-1.5 text-[0.7rem] text-foreground", children: [_jsx("span", { className: "size-2 rounded-[1px]", style: { background: MIX_COLORS[p.key] } }), TOKEN_MIX_LABELS[p.key]] }), _jsxs("span", { className: "text-[0.7rem] text-(--ui-text-tertiary)", children: [compact(p.v), " \u00B7 ", ((p.v / sum) * 100).toFixed(p.v / sum < 0.01 ? 1 : 0), "%"] })] }, p.key))) })] }));
}
function Punchcard({ rows }) {
    const max = Math.max(1, ...rows.map((r) => r.sessions));
    const at = new Map(rows.map((r) => [`${r.weekday}:${r.hour}`, r.sessions]));
    return (_jsx("div", { className: "overflow-x-auto", children: _jsxs("div", { style: { display: "grid", gridTemplateColumns: `28px repeat(24, minmax(10px, 1fr))`, gap: 3, minWidth: 340 }, children: [_jsx("span", {}), Array.from({ length: 24 }, (_, h) => (_jsx("span", { className: "text-center text-[0.55rem] text-(--ui-text-tertiary)", children: h % 6 === 0 ? h : "" }, h))), WEEKDAYS.map((wd, w) => [
                    _jsx("span", { className: "text-[0.6rem] leading-[12px] text-(--ui-text-tertiary)", children: wd }, wd),
                    ...Array.from({ length: 24 }, (_, h) => {
                        const n = at.get(`${w}:${h}`) ?? 0;
                        const level = n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4));
                        return (_jsx("span", { style: { height: 12, borderRadius: 2, background: levelColor(level) }, title: `${wd} ${pad(h)}:00 · ${plural(n, "session")}` }, `${w}:${h}`));
                    }),
                ])] }) }));
}
function SessionRows({ sessions, empty }) {
    if (!sessions.length)
        return _jsx("div", { className: CAPTION, children: empty });
    const open = (id) => {
        if (typeof host.openSession === "function")
            void host.openSession(id);
    };
    return (_jsx("ul", { children: sessions.map((s) => (_jsx("li", { children: _jsxs("button", { className: "flex w-full items-center gap-3 py-2 text-left", onClick: () => open(s.id), type: "button", children: [_jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("div", { className: `truncate font-medium ${TEXT}`, children: s.title || s.id }), _jsx("div", { className: `truncate ${CAPTION}`, children: [
                                    new Date(s.started_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                                    s.source,
                                    s.model,
                                    s.parent_session_id ? "subagent" : null,
                                ]
                                    .filter(Boolean)
                                    .join(" · ") })] }), _jsxs("div", { className: "shrink-0 text-right text-[0.7rem] text-(--ui-text-tertiary)", children: [_jsx("div", { className: "text-foreground", children: compact(s.tokens) }), _jsxs("div", { children: [s.messages, " msgs \u00B7 ", s.tool_calls, " tools"] })] })] }) }, s.id))) }));
}
// ───────────────────────────────────────────────────────────── page
function streaks(daily) {
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
    if (!active.has(isoDay(d)))
        d.setDate(d.getDate() - 1);
    while (active.has(isoDay(d))) {
        current++;
        d.setDate(d.getDate() - 1);
    }
    return { current, longest: Math.max(longest, current), activeDays: active.size };
}
const PROVIDER_NAMES = {
    all: "All providers",
    commandcode: "CommandCode",
    "opencode-go": "OpenCode Go/Zen",
    "openai-codex": "Codex",
    ollama: "Ollama",
};
const providerName = (id) => PROVIDER_NAMES[id] ?? id;
const OVERVIEW_STATUS_TEXT = {
    available: "Available",
    "summary-only": "Summary only",
    "auth-required": "Credentials required",
    unavailable: "Unavailable",
    "not-collected": "Not collected",
    "not-integrated": "Not integrated",
};
const OVERVIEW_STATUS_HINT = {
    available: "Activity reads this source's usage records.",
    "summary-only": "This source reports period totals but no dated records.",
    "auth-required": "No usable credentials were found, so no usage was read.",
    unavailable: "This source did not return usage for this range.",
    "not-collected": "No provider data was fetched for this range yet.",
    "not-integrated": "No history source is configured for this provider.",
};
const shortStamp = (value) => {
    const [date, time] = value.split("T");
    if (!time)
        return prettyDay(date);
    const hhmm = time.slice(0, 5);
    return time.endsWith("Z") ? `${date} ${hhmm} UTC` : `${date} ${hhmm}`;
};
const overviewMetricLabel = (value, metric) => metric === "spend" ? money(value) : metric === "tokens" ? plural(value, "token") : plural(value, "request");
const dayDetailText = (row) => {
    if (!row)
        return "No record on the selected day.";
    return [
        row.day,
        `requests ${overviewMetricText(row.requests, "count")}`,
        `tokens ${overviewMetricText(row.tokens, "tokens")}`,
        `input ${overviewMetricText(row.input_tokens, "tokens")}`,
        `output ${overviewMetricText(row.output_tokens, "tokens")}`,
        `cache read ${overviewMetricText(row.cache_read_tokens, "tokens")}`,
        `reasoning ${overviewMetricText(row.reasoning_tokens, "tokens")}`,
        `cost ${overviewSpendText(row.cost_usd)}`,
    ].join(" · ");
};
async function providerHistoryQuery(scope, mode = "cached") {
    return parseProviderHistory(await activityCli(scope, providerHistoryArgs(mode)));
}
function OverviewLegend() {
    return (_jsxs("span", { className: "inline-flex items-center gap-1 text-[0.6rem] text-(--ui-text-tertiary)", children: ["Less", [0, 1, 2, 3, 4].map((level) => (_jsx("span", { style: { width: CELL, height: CELL, borderRadius: 2, background: levelColor(level) } }, level))), "More", _jsx("span", { className: "ml-1", style: { width: CELL, height: CELL, borderRadius: 2, border: "1px dashed color-mix(in srgb, currentColor 40%, transparent)" } }), "not reported"] }));
}
function OverviewHeatmap({ daily, start, end, metric, selectedDay, onSelectDay, }) {
    const refs = useRef(new Map());
    const [focusDay, setFocusDay] = useState(null);
    const model = useMemo(() => {
        const byDay = new Map(daily.map((row) => [row.day, row]));
        const startMs = Date.parse(`${start}T00:00:00Z`);
        const offset = new Date(startMs).getUTCDay();
        const gridStartMs = startMs - offset * 86_400_000;
        const days = overviewDaySequence(start, end);
        const weeks = Math.ceil((offset + days.length) / 7);
        const known = days
            .map((day) => byDay.get(day))
            .filter((row) => !!row)
            .map((row) => overviewDayValue(row, metric))
            .filter((value) => value !== null && value > 0)
            .sort((a, b) => a - b);
        const quantile = (fraction) => known[Math.min(known.length - 1, Math.floor(known.length * fraction))] ?? 0;
        const thresholds = [quantile(0.25), quantile(0.5), quantile(0.75)];
        const level = (value) => value <= 0 ? 0 : value <= thresholds[0] ? 1 : value <= thresholds[1] ? 2 : value <= thresholds[2] ? 3 : 4;
        const cols = [];
        let prevMonth = -1;
        for (let week = 0; week < weeks; week++) {
            const colStartMs = gridStartMs + week * 7 * 86_400_000;
            const cells = [];
            for (let dow = 0; dow < 7; dow++) {
                const day = new Date(colStartMs + dow * 86_400_000).toISOString().slice(0, 10);
                const inRange = day >= start && day <= end;
                const row = inRange ? byDay.get(day) : undefined;
                cells.push({ day, row, value: row ? overviewDayValue(row, metric) : null, out: !inRange });
            }
            const anchor = cells.find((cell) => !cell.out) ?? cells[0];
            const month = new Date(`${anchor.day}T00:00:00Z`).getUTCMonth();
            cols.push({ month: month !== prevMonth ? MONTHS[month] : "", cells });
            prevMonth = month;
        }
        // A leading label is wider than its column: drop it when the next month starts right after.
        if (cols[0]?.month && (cols[1]?.month || cols[2]?.month))
            cols[0].month = "";
        return { cols, level };
    }, [daily, start, end, metric]);
    const inRange = model.cols.flatMap((col) => col.cells.filter((cell) => !cell.out));
    const labelFor = (cell) => {
        if (!cell.row)
            return `${prettyDay(cell.day)}: no record`;
        const base = cell.value === null ? "not reported" : overviewMetricLabel(cell.value, metric);
        const coverage = cell.row.coverage && cell.row.coverage.expected > 0 && cell.row.coverage.reported < cell.row.coverage.expected
            ? ` · ${cell.row.coverage.reported}/${cell.row.coverage.expected} sources reported`
            : "";
        return `${prettyDay(cell.day)}: ${base}${coverage}`;
    };
    const focusIndex = (index) => {
        if (!inRange.length)
            return;
        const clamped = Math.max(0, Math.min(inRange.length - 1, index));
        const day = inRange[clamped].day;
        setFocusDay(day);
        refs.current.get(day)?.focus();
    };
    const currentIndex = inRange.findIndex((cell) => cell.day === focusDay);
    const tabDay = focusDay ?? inRange[0]?.day ?? null;
    const labelCol = { display: "grid", gridTemplateRows: `14px repeat(7, ${CELL}px)`, gap: GAP, marginRight: 6 };
    return (_jsxs("div", { className: "overflow-x-auto pb-1", onKeyDown: (event) => {
            const target = event.target.closest("[data-day]");
            if (!target?.dataset.day)
                return;
            const index = inRange.findIndex((cell) => cell.day === target.dataset.day);
            if (index < 0)
                return;
            if (event.key === "ArrowLeft") {
                event.preventDefault();
                focusIndex(index - 1);
            }
            else if (event.key === "ArrowRight") {
                event.preventDefault();
                focusIndex(index + 1);
            }
            else if (event.key === "ArrowUp") {
                event.preventDefault();
                focusIndex(index - 7);
            }
            else if (event.key === "ArrowDown") {
                event.preventDefault();
                focusIndex(index + 7);
            }
            else if (event.key === "Home") {
                event.preventDefault();
                focusIndex(0);
            }
            else if (event.key === "End") {
                event.preventDefault();
                focusIndex(inRange.length - 1);
            }
            else if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectDay(selectedDay === target.dataset.day ? null : target.dataset.day);
            }
        }, children: [_jsxs("div", { style: { display: "flex", width: "max-content" }, children: [_jsxs("div", { "aria-hidden": true, style: labelCol, children: [_jsx("span", {}), WEEKDAYS.map((weekday, index) => (_jsx("span", { className: "text-[0.6rem] leading-[11px] text-(--ui-text-tertiary)", children: index % 2 === 1 ? weekday : "" }, weekday)))] }), _jsx("div", { "aria-label": "Provider daily usage by day", role: "grid", style: { display: "grid", gridAutoFlow: "column", gridTemplateRows: `14px repeat(7, ${CELL}px)`, gridAutoColumns: CELL, gap: GAP }, children: model.cols.map((col, ci) => [
                            _jsx("span", { className: "overflow-visible whitespace-nowrap text-[0.6rem] leading-[14px] text-(--ui-text-tertiary)", children: col.month }, `m${ci}`),
                            ...col.cells.map((cell) => cell.out ? (_jsx("span", {}, cell.day)) : (_jsx("span", { "aria-label": labelFor(cell), "aria-selected": selectedDay === cell.day, "data-day": cell.day, onClick: () => onSelectDay(selectedDay === cell.day ? null : cell.day), onFocus: () => setFocusDay(cell.day), ref: (element) => {
                                    if (element)
                                        refs.current.set(cell.day, element);
                                    else
                                        refs.current.delete(cell.day);
                                }, role: "gridcell", tabIndex: cell.day === tabDay ? 0 : -1, title: labelFor(cell), style: {
                                    width: CELL,
                                    height: CELL,
                                    borderRadius: 2,
                                    cursor: "pointer",
                                    background: cell.value !== null ? levelColor(model.level(cell.value)) : "transparent",
                                    border: cell.value === null ? "1px dashed color-mix(in srgb, currentColor 40%, transparent)" : undefined,
                                    outline: selectedDay === cell.day ? "1px solid var(--ui-text-primary, currentColor)" : undefined,
                                    outlineOffset: 1,
                                } }, cell.day))),
                        ]) })] }), _jsx("span", { className: `mt-1 block ${CAPTION}`, children: currentIndex >= 0 ? `Focused ${prettyDay(inRange[currentIndex].day)}` : "One cell is in the tab order; arrow keys move between days." })] }));
}
function OverviewDailyTable({ rows, providerColumn, selectedDay, }) {
    if (!rows.length)
        return _jsx("div", { className: CAPTION, children: "No dated records for this range." });
    const sorted = [...rows].sort((a, b) => (a.day === b.day ? (a.provider ?? "").localeCompare(b.provider ?? "") : a.day < b.day ? -1 : 1));
    const metricCell = (value, kind) => value === null ? _jsx("span", { className: "text-(--ui-text-tertiary)", children: "not reported" }) : _jsx("span", { children: overviewMetricText(value, kind) });
    const headers = ["Requests", "Tokens", "Input", "Output", "Cache read", "Cache write", "Reasoning"];
    return (_jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full min-w-max border-collapse text-[0.7rem]", children: [_jsx("thead", { children: _jsxs("tr", { className: "text-left", children: [providerColumn && _jsx("th", { className: `pb-1 pr-3 font-medium ${LABEL}`, children: "Provider" }), _jsx("th", { className: `pb-1 pr-3 font-medium ${LABEL}`, children: "Day" }), headers.map((label) => (_jsx("th", { className: `pb-1 pr-3 text-right font-medium ${LABEL}`, children: label }, label))), _jsx("th", { className: `pb-1 text-right font-medium ${LABEL}`, children: "Cost" })] }) }), _jsx("tbody", { children: sorted.map((row) => (_jsxs("tr", { className: selectedDay === row.day ? "bg-(--chrome-action-hover)" : undefined, children: [providerColumn && (_jsx("td", { className: "py-1 pr-3 font-mono text-[0.66rem] text-(--ui-text-tertiary)", children: providerName(row.provider ?? "unknown") })), _jsx("td", { className: "py-1 pr-3 font-mono text-[0.66rem] text-foreground", children: row.day }), _jsx("td", { className: "py-1 pr-3 text-right", children: metricCell(row.requests, "count") }), _jsx("td", { className: "py-1 pr-3 text-right", children: metricCell(row.tokens, "tokens") }), _jsx("td", { className: "py-1 pr-3 text-right", children: metricCell(row.input_tokens, "tokens") }), _jsx("td", { className: "py-1 pr-3 text-right", children: metricCell(row.output_tokens, "tokens") }), _jsx("td", { className: "py-1 pr-3 text-right", children: metricCell(row.cache_read_tokens, "tokens") }), _jsx("td", { className: "py-1 pr-3 text-right", children: metricCell(row.cache_write_tokens, "tokens") }), _jsx("td", { className: "py-1 pr-3 text-right", children: metricCell(row.reasoning_tokens, "tokens") }), _jsx("td", { className: "py-1 text-right", children: row.cost_usd === null ? "not reported" : overviewSpendText(row.cost_usd) })] }, `${row.provider ?? ""}::${row.day}`))) })] }) }));
}
function ArchiveTable({ rows }) {
    const sorted = [...rows].sort((a, b) => (a.day === b.day ? a.provider.localeCompare(b.provider) : a.day < b.day ? -1 : 1));
    const cells = (row) => [row.requests, row.tokens, row.input_tokens, row.output_tokens, row.cache_read_tokens, row.reasoning_tokens];
    return (_jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full min-w-max border-collapse text-[0.7rem]", children: [_jsx("thead", { children: _jsxs("tr", { className: "text-left", children: [_jsx("th", { className: `pb-1 pr-3 font-medium ${LABEL}`, children: "Provider" }), _jsx("th", { className: `pb-1 pr-3 font-medium ${LABEL}`, children: "Day" }), ["Requests", "Tokens", "Input", "Output", "Cache read", "Reasoning"].map((label) => (_jsx("th", { className: `pb-1 pr-3 text-right font-medium ${LABEL}`, children: label }, label))), _jsx("th", { className: `pb-1 text-right font-medium ${LABEL}`, children: "Cost" })] }) }), _jsx("tbody", { children: sorted.map((row) => (_jsxs("tr", { children: [_jsx("td", { className: "py-1 pr-3 font-mono text-[0.66rem] text-(--ui-text-tertiary)", children: providerName(row.provider) }), _jsx("td", { className: "py-1 pr-3 font-mono text-[0.66rem] text-foreground", children: row.day }), cells(row).map((value, index) => (_jsx("td", { className: "py-1 pr-3 text-right", children: compact(value) }, index))), _jsx("td", { className: "py-1 text-right", children: row.cost_usd === null ? "not reported" : overviewSpendText(row.cost_usd) })] }, `${row.provider}::${row.day}`))) })] }) }));
}
function ProviderPeriodRows({ period }) {
    const chips = overviewMetricChips(period);
    return (_jsxs("span", { className: "flex flex-col gap-1 border-t border-(--ui-border-subtle) pt-1.5", children: [_jsxs("span", { className: "flex items-baseline justify-between gap-2", children: [_jsx("span", { className: "truncate text-[0.72rem] text-foreground", children: period.label }), _jsx("span", { className: "shrink-0 text-[0.6rem] text-(--ui-text-tertiary)", children: period.basis })] }), (period.start || period.end) && (_jsxs("span", { className: `block truncate ${CAPTION}`, children: [period.start ? shortStamp(period.start) : "open start", " to ", period.end ? shortStamp(period.end) : "open end"] })), _jsx("span", { className: "flex flex-wrap gap-x-3 gap-y-0.5 text-[0.72rem] text-(--ui-text-secondary)", children: chips.length ? chips.map((chip) => _jsx("span", { children: chip }, chip)) : _jsx("span", { className: CAPTION, children: "No reported metrics" }) }), period.models.length > 0 && (_jsx("span", { className: "flex flex-col gap-0.5", children: period.models.slice(0, 4).map((model) => (_jsxs("span", { className: "flex items-center justify-between gap-2", children: [_jsx("span", { className: "truncate font-mono text-[0.66rem] text-(--ui-text-tertiary)", children: model.model }), _jsx("span", { className: "shrink-0 text-[0.66rem] text-(--ui-text-tertiary)", children: overviewMetricChips(model).join(" · ") || "not reported" })] }, model.model))) }))] }));
}
function ProviderSourceRow({ record }) {
    const period = record.periods[0];
    const chips = period ? overviewMetricChips(period) : [];
    const summary = chips.length
        ? chips.join(" · ")
        : period
            ? `${period.label} · no reported metrics`
            : record.daily.length
                ? `${record.daily.length} dated record${record.daily.length === 1 ? "" : "s"}`
                : OVERVIEW_STATUS_HINT[record.status];
    return (_jsx("li", { className: "py-2", children: _jsxs("details", { children: [_jsx("summary", { className: "cursor-pointer text-[0.8rem] text-foreground", children: _jsxs("span", { className: "inline-flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 align-middle", children: [_jsx("span", { className: "font-semibold tracking-tight", children: providerName(record.id) }), _jsx("span", { className: "rounded-full border border-(--ui-stroke-secondary) px-1.5 py-0.5 text-[0.6rem] text-(--ui-text-tertiary)", children: OVERVIEW_STATUS_TEXT[record.status] }), _jsx("span", { className: `truncate ${CAPTION}`, children: summary })] }) }), _jsxs("div", { className: "mt-2 flex flex-col gap-1.5", children: [_jsxs("span", { className: CAPTION, children: [record.scope, " \u00B7 ", record.source] }), _jsx("span", { className: CAPTION, children: record.data_as_of
                                ? `Data as of ${shortStamp(record.data_as_of)}`
                                : record.fetched_at
                                    ? `Fetched ${shortStamp(record.fetched_at)}`
                                    : "No fetch timestamp" }), record.periods.map((entry) => (_jsx(ProviderPeriodRows, { period: entry }, `${entry.label}::${entry.basis}`))), record.windows.map((window) => (_jsxs("span", { className: CAPTION, children: [window.label, ": ", window.used_percent === null ? "usage not reported" : `${window.used_percent.toFixed(1)}% used`, window.reset_at ? `, resets ${shortStamp(window.reset_at)}` : ""] }, `${window.label}::${window.reset_at ?? ""}`))), record.reason && _jsxs("span", { className: "font-mono text-[0.62rem] text-(--ui-text-tertiary)", children: ["reason: ", record.reason] }), record.note && _jsx("span", { className: CAPTION, children: record.note }), (!record.periods.length || record.status !== "available") && _jsx("span", { className: CAPTION, children: OVERVIEW_STATUS_HINT[record.status] })] })] }) }));
}
function ProviderTokenMixSection({ breakdown, scopeLabel }) {
    const mix = providerTokenMix(breakdown);
    const canDraw = mix.denominator !== null && mix.denominator > 0;
    const hasAny = mix.segments.some((segment) => segment.tokens !== null);
    const caption = canDraw
        ? `Token mix for ${scopeLabel}, using each source's own reported token total over the annual window. Unknown components stay not reported.`
        : `No component tokens were reported by ${scopeLabel} for the annual window, so no mix can be drawn.`;
    return (_jsxs("div", { className: "flex flex-col gap-3", children: [_jsx("div", { className: "flex h-2 overflow-hidden rounded-full", style: { background: levelColor(0) }, children: canDraw &&
                    mix.segments.map((segment) => segment.share && segment.share > 0 ? (_jsx("span", { style: { width: `${segment.share * 100}%`, background: MIX_COLORS[segment.key] } }, segment.key)) : null) }), _jsx("ul", { className: "mt-0.5", children: mix.segments.map((segment) => (_jsxs("li", { className: "flex items-center justify-between gap-2 py-1", children: [_jsxs("span", { className: "inline-flex items-center gap-1.5 text-[0.7rem] text-foreground", children: [_jsx("span", { className: "size-2 rounded-[1px]", style: { background: MIX_COLORS[segment.key] } }), TOKEN_MIX_LABELS[segment.key]] }), _jsx("span", { className: "text-[0.7rem] text-(--ui-text-tertiary)", children: segment.tokens === null
                                ? "not reported"
                                : segment.share === null
                                    ? overviewMetricText(segment.tokens, "tokens")
                                    : `${overviewMetricText(segment.tokens, "tokens")} · ${segment.share > 0 && segment.share * 100 < 0.1 ? "<0.1" : (segment.share * 100).toFixed(segment.share * 100 < 1 ? 1 : 0)}%` })] }, segment.key))) }), _jsxs("span", { className: CAPTION, children: [caption, hasAny && mix.partial ? " Some components are unreported, so percentages are shown only against the reported total." : ""] })] }));
}
function ProviderModelBreakdown({ rows }) {
    return (_jsx(List, { empty: "No per-model rows were reported by any source.", rows: rows.map((row) => ({
            key: `${row.source}::${row.period}::${row.model}`,
            label: row.model,
            value: overviewMetricChips({ requests: row.requests, tokens: row.tokens, cost_usd: row.cost_usd }).join(" · ") || "not reported",
            hint: `${providerName(row.source)} · ${row.period}`,
        })) }));
}
function ProviderSummaryTiles({ breakdown }) {
    const tiles = [
        { label: "Total tokens", value: overviewMetricText(breakdown.tokens, "tokens") },
        { label: "Input", value: overviewMetricText(breakdown.input_tokens, "tokens") },
        { label: "Output", value: overviewMetricText(breakdown.output_tokens, "tokens") },
        { label: "Cache read", value: overviewMetricText(breakdown.cache_read_tokens, "tokens") },
        { label: "Cache write", value: overviewMetricText(breakdown.cache_write_tokens, "tokens") },
        { label: "Reasoning", value: overviewMetricText(breakdown.reasoning_tokens, "tokens") },
        { label: "Requests", value: overviewMetricText(breakdown.requests, "count") },
        { label: "Reported spend (USD)", value: overviewSpendText(breakdown.cost_usd) },
        {
            label: "Active days",
            value: overviewMetricText(breakdown.active_days, "count"),
            hint: `${overviewMetricText(breakdown.reported_days, "count")} dated row${breakdown.reported_days === 1 ? "" : "s"}`,
        },
    ];
    return (_jsx("div", { className: "grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 lg:grid-cols-4", children: tiles.map((tile) => (_jsx(Stat, { hint: tile.hint, label: tile.label, value: tile.value }, tile.label))) }));
}
function ProviderHistoryView({ history, onFetch, fetching, fetchError, }) {
    const [selected, setSelected] = useState(DEFAULT_PROVIDER_SELECTION);
    const [metric, setMetric] = useState("tokens");
    const [selectedDay, setSelectedDay] = useState(null);
    const records = history.overview;
    const selectedId = selected === DEFAULT_PROVIDER_SELECTION || records.some((record) => record.id === selected) ? selected : DEFAULT_PROVIDER_SELECTION;
    const activeRecord = records.find((record) => record.id === selectedId) ?? null;
    const showingAll = selectedId === DEFAULT_PROVIDER_SELECTION;
    const selectProvider = (id) => {
        setSelected(id);
        setSelectedDay(null);
        CTX?.storage.set("provider", id);
    };
    // Combined view sums each source's own dated records. Summary-only sources expose no dated
    // rows, so their period totals stay in the source summaries and never enter the timeline.
    const combined = aggregateProviderDaily(records.map((record) => ({ id: record.id, daily: record.daily })), history.range.start, history.range.end);
    const reportingSources = records.filter((record) => record.daily.length > 0).length;
    const chartRows = showingAll
        ? combined.map((row) => ({ ...row, coverage: row.metricCoverage[metric] }))
        : activeRecord?.daily ?? [];
    const tableRows = showingAll
        ? records.flatMap((record) => record.daily.map((row) => ({ ...row, provider: record.id })))
        : activeRecord?.daily ?? [];
    const chartHasData = showingAll ? reportingSources > 0 : (activeRecord?.daily.length ?? 0) > 0;
    const summary = aggregateProviderBreakdown(records.map((record) => ({ id: record.id, breakdown: record.breakdown, daily: record.daily })), history.range.start, history.range.end);
    const summaryBreakdown = showingAll ? summary.breakdown : activeRecord?.breakdown ?? EMPTY_PROVIDER_BREAKDOWN;
    const summaryPartial = Object.values(summary.metricCoverage).some((entry) => entry.expected > 0 && entry.reported < entry.expected);
    const summaryCaption = showingAll
        ? summary.contributors > 0
            ? `Combined from ${summary.contributors} source${summary.contributors === 1 ? "" : "s"} reporting dated records${summary.contributors < records.length ? ` of ${records.length}` : ""}. Spend adds each reported cost exactly and active days union the dates sources report; the annual window is requested, not full provider history.`
            : "No source reports dated records for this annual window, so combined metrics stay not reported."
        : activeRecord?.status === "summary-only"
            ? "This source reports period totals only, so annual metrics stay not reported. Its period summary remains under Provider sources."
            : (activeRecord?.daily.length ?? 0) > 0
                ? "Summed from this source's dated records for the annual window."
                : "This source reported no dated records for the annual window.";
    const selectedRow = chartRows.find((row) => row.day === selectedDay) ?? null;
    const modelRows = providerModelBreakdown(history);
    const scopeLabel = showingAll ? "all sources" : providerName(selectedId);
    const outsideRangeNote = (rows) => rows.some((row) => row.day < history.range.start || row.day > history.range.end) ? (_jsx("div", { className: `mt-2 ${CAPTION}`, children: "Rows outside the annual window are provider-dated and shown as reported." })) : null;
    const metricOptions = [
        { id: "requests", label: "Requests" },
        { id: "tokens", label: "Tokens" },
        { id: "spend", label: "Spend" },
    ];
    const emptyChartText = showingAll
        ? "Fetch provider data to populate the annual timeline. Reads use existing credentials only; nothing is signed in or changed automatically."
        : activeRecord?.status === "summary-only"
            ? "This source reports period totals only, so there are no dated records to chart."
            : "No dated records from this source for this annual window yet.";
    return (_jsxs("div", { className: "flex flex-col gap-6", children: [_jsxs("div", { className: "flex flex-wrap items-end justify-between gap-3", children: [_jsxs("label", { className: "flex min-w-0 items-center gap-2", children: [_jsx("span", { className: LABEL, children: "Provider" }), _jsxs("select", { className: "min-w-0 max-w-[16rem] rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) px-2 py-1 text-[0.75rem] text-foreground", onChange: (event) => selectProvider(event.target.value), value: selectedId, children: [_jsxs("option", { value: DEFAULT_PROVIDER_SELECTION, children: ["All providers", reportingSources ? ` (${reportingSources} reporting)` : ""] }), records.map((record) => (_jsxs("option", { value: record.id, children: [providerName(record.id), " \u2014 ", OVERVIEW_STATUS_TEXT[record.status]] }, record.id)))] })] }), _jsxs("div", { className: "flex min-w-0 flex-wrap items-center gap-2", children: [fetchError && _jsx("span", { className: `max-w-xs truncate ${CAPTION}`, title: fetchError, children: fetchError }), _jsx(SegmentedControl, { onChange: (id) => setMetric(id), options: metricOptions, value: metric }), _jsxs("button", { className: "inline-flex shrink-0 items-center gap-1.5 rounded border border-(--ui-stroke-secondary) px-2 py-1 text-[0.7rem] text-foreground hover:bg-(--chrome-action-hover) disabled:opacity-60", disabled: fetching, onClick: onFetch, type: "button", children: [_jsx(Codicon, { name: "cloud-download", spinning: fetching }), fetching ? "Fetching provider data" : "Fetch provider data"] })] })] }), _jsx(Section, { title: showingAll ? "Combined daily usage" : `${providerName(selectedId)} daily usage`, children: chartHasData ? (_jsxs("div", { className: "flex flex-col gap-2", children: [_jsx(OverviewHeatmap, { daily: chartRows, end: history.range.end, metric: metric, onSelectDay: setSelectedDay, selectedDay: selectedDay, start: history.range.start }), _jsxs("div", { className: "flex flex-wrap items-center justify-between gap-3", children: [_jsx("span", { className: "text-[0.6rem] text-(--ui-text-tertiary)", children: selectedDay ? dayDetailText(selectedRow) : "Arrow keys move between days, Enter selects one." }), _jsx(OverviewLegend, {})] }), _jsx("span", { className: CAPTION, children: showingAll
                                ? `Combined across ${reportingSources} source${reportingSources === 1 ? "" : "s"} that report dated records. Each day sums the values sources actually reported; days only some sources covered are marked partial and missing values are never counted as zero.`
                                : "This source's own dated records for the annual window." }), _jsxs("details", { className: "rounded border border-(--ui-border-subtle)", children: [_jsx("summary", { className: "cursor-pointer px-2 py-1 text-[0.72rem] text-(--ui-text-secondary)", children: "Daily records table" }), _jsxs("div", { className: "px-2 pb-2", children: [_jsx(OverviewDailyTable, { providerColumn: showingAll, rows: tableRows, selectedDay: selectedDay }), outsideRangeNote(tableRows)] })] })] })) : (_jsx("div", { className: CAPTION, children: emptyChartText })) }), _jsx(Section, { title: showingAll ? "Combined usage summary" : `${providerName(selectedId)} usage summary`, children: _jsxs("div", { className: "flex flex-col gap-3", children: [_jsx(ProviderSummaryTiles, { breakdown: summaryBreakdown }), _jsxs("span", { className: CAPTION, children: [summaryCaption, showingAll && summaryPartial ? " Some sources report only part of these metrics; unreported values stay blank rather than zero." : ""] })] }) }), _jsx(Section, { title: "Token mix", children: _jsx(ProviderTokenMixSection, { breakdown: summaryBreakdown, scopeLabel: scopeLabel }) }), _jsxs(Section, { title: "Model breakdown by source period", children: [_jsx(ProviderModelBreakdown, { rows: modelRows }), _jsx("div", { className: `mt-2 ${CAPTION}`, children: "Each row belongs to one source and one period (for example \u201CLifetime\u201D or \u201CLast 30 days\u201D). Model totals are never merged across periods or folded into the annual window, so different-period figures are never added together." })] }), _jsxs(Section, { title: "Provider sources", children: [records.length ? (_jsx("ul", { className: "divide-y divide-(--ui-border-subtle)", children: records.map((record) => (_jsx(ProviderSourceRow, { record: record }, record.id))) })) : (_jsx("ul", { className: "divide-y divide-(--ui-border-subtle)", children: history.providers.map((provider) => (_jsxs("li", { className: "flex items-center justify-between gap-3 py-2", children: [_jsx("span", { className: TEXT, children: providerName(provider.id) }), _jsx("span", { className: CAPTION, children: !provider.supported
                                        ? "History not available from this provider"
                                        : provider.has_history
                                            ? "Provider history captured"
                                            : "Supported, no records captured in the annual window" })] }, provider.id))) })), !records.length && !history.providers.length && _jsx("div", { className: CAPTION, children: "No providers are configured." }), !records.length && (_jsx("div", { className: `mt-2 ${CAPTION}`, children: "The installed Activity backend does not report per-provider source summaries yet. Fetch provider data after updating the plugin to populate them." })), _jsx("div", { className: `mt-2 ${CAPTION}`, children: "Expand a source for its scope, timestamps, notes and model rows. Period totals come from each provider's own report and are never converted from usage percentages." })] }), history.daily.length > 0 && (_jsxs(Section, { title: "Local archive events", children: [_jsx(ArchiveTable, { rows: history.daily }), _jsx("div", { className: `mt-2 ${CAPTION}`, children: "Provider-reported events archived locally; separate from the source summaries above." })] }))] }));
}
function rangeArgs(range) {
    return /^\d{4}$/.test(range) ? ["--year", range] : ["--days", range];
}
function ActivityPage() {
    const { scope, key } = useScope();
    const [range, setRange] = useState(() => CTX?.storage.get("range") || "365");
    const [view, setView] = useState(() => CTX?.storage.get("view") || "hermes");
    const [metric, setMetric] = useState(() => CTX?.storage.get("metric") || "tokens");
    const [selected, setSelected] = useState(null);
    const [freshProviderHistory, setFreshProviderHistory] = useState(null);
    const [fetchingProviders, setFetchingProviders] = useState(false);
    const [fetchProviderError, setFetchProviderError] = useState(null);
    const qc = useQueryClient();
    useRefreshOnTurnEnd(PREFIX);
    const q = useQuery({
        queryKey: [...PREFIX, "summary", key, range],
        queryFn: () => activityCli(scope, ["summary", ...rangeArgs(range), "--desktop"]),
        staleTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
        placeholderData: (prev) => prev,
    });
    const dayQ = useQuery({
        queryKey: [...PREFIX, "day", key, selected],
        queryFn: () => activityCli(scope, ["day", selected]),
        enabled: !!selected,
        staleTime: 5 * 60_000,
        retry: 1,
    });
    const providerQ = useQuery({
        queryKey: [...PREFIX, "provider-history", key, PROVIDER_WINDOW_DAYS],
        queryFn: () => providerHistoryQuery(scope),
        enabled: view === "providers",
        staleTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
    });
    useEffect(() => {
        setFetchProviderError(null);
    }, [key]);
    const providerKeyRef = useRef(key);
    providerKeyRef.current = key;
    const fetchProviders = async () => {
        const targetKey = providerKeyRef.current;
        setFetchingProviders(true);
        setFetchProviderError(null);
        try {
            const history = await providerHistoryQuery(scope, "refresh");
            setFreshProviderHistory({ key: targetKey, history });
            void qc.invalidateQueries({ queryKey: [...PREFIX, "provider-history", targetKey, PROVIDER_WINDOW_DAYS] });
        }
        catch (error) {
            if (providerKeyRef.current === targetKey) {
                setFetchProviderError(error instanceof Error ? error.message : String(error));
            }
        }
        finally {
            setFetchingProviders(false);
        }
    };
    const providerHistory = freshProviderHistory && freshProviderHistory.key === key ? freshProviderHistory.history : providerQ.data;
    const data = q.data;
    const thisYear = new Date().getFullYear();
    const firstYear = data?.first_activity_day ? parseDay(data.first_activity_day).getFullYear() : thisYear;
    const rangeOptions = [
        { id: "30", label: "30d" },
        { id: "90", label: "90d" },
        { id: "365", label: "12m" },
        ...Array.from({ length: Math.min(5, thisYear - firstYear + 1) }, (_, i) => String(thisYear - i)).map((y) => ({ id: y, label: y })),
    ];
    const header = (_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-3 pb-4 pt-5", children: [_jsxs("div", { className: "min-w-0", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Codicon, { name: "graph" }), _jsx("h1", { className: "text-base font-semibold tracking-tight text-foreground", children: "Activity" })] }), _jsxs("div", { className: `mt-0.5 ${CAPTION}`, children: [view === "providers" && providerHistory
                                ? `${prettyDay(providerHistory.range.start)} – ${prettyDay(providerHistory.range.end)} · provider-reported history`
                                : data ? `${prettyDay(data.range.start)} – ${prettyDay(data.range.end)}` : "Your Hermes usage, read from the local session store", scope?.profile ? ` · ${scope.profile}` : ""] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(SegmentedControl, { onChange: (id) => {
                            setView(id);
                            CTX?.storage.set("view", id);
                        }, options: [{ id: "hermes", label: "Hermes" }, { id: "providers", label: "Providers" }], value: view }), view === "hermes" && (_jsx(SegmentedControl, { onChange: (id) => {
                            setRange(id);
                            setSelected(null);
                            CTX?.storage.set("range", id);
                        }, options: rangeOptions, value: range })), _jsx(IconButton, { icon: "refresh", label: view === "providers" ? "Reload cached history" : "Refresh", onClick: () => void (view === "providers" ? providerQ.refetch() : q.refetch()), spinning: view === "providers" ? providerQ.isFetching : q.isFetching })] })] }));
    const shell = (children) => (_jsxs("div", { className: "flex h-full min-h-0 flex-col overflow-y-auto px-[clamp(1.25rem,4vw,4rem)] pb-8", children: [header, children] }));
    if (view === "providers") {
        if (!providerHistory && providerQ.error) {
            const message = providerQ.error instanceof Error ? providerQ.error.message : String(providerQ.error);
            return shell(_jsxs("div", { className: "grid place-items-center gap-2 py-16 text-center", children: [_jsx(Codicon, { name: "warning" }), _jsx("div", { className: TEXT, children: "Couldn't load provider history" }), _jsx("div", { className: `max-w-md ${CAPTION}`, children: message }), _jsx("div", { className: `max-w-md ${CAPTION}`, children: "Provider history comes from the Activity backend's local provider archive and live source summaries. It is distinct from Hermes session activity." }), _jsxs("div", { className: "mt-2 flex items-center gap-3", children: [_jsx("button", { className: "text-[0.75rem] text-(--ui-accent) hover:underline", onClick: () => void providerQ.refetch(), type: "button", children: "Retry" }), _jsx("button", { className: "text-[0.75rem] text-(--ui-accent) hover:underline", onClick: () => void fetchProviders(), type: "button", children: "Fetch provider data" })] })] }));
        }
        if (!providerHistory) {
            return shell(_jsxs("div", { className: "flex flex-col gap-5", "aria-busy": "true", "aria-label": "Loading provider history", children: [_jsx(Skeleton, { className: "h-32" }), _jsx(Skeleton, { className: "h-40" })] }));
        }
        return shell(_jsx(ProviderHistoryView, { fetchError: fetchProviderError, fetching: fetchingProviders, history: providerHistory, onFetch: fetchProviders }));
    }
    if (!data) {
        if (q.error) {
            const msg = q.error instanceof Error ? q.error.message : String(q.error);
            return shell(_jsxs("div", { className: "grid place-items-center gap-2 py-16 text-center", children: [_jsx(Codicon, { name: "warning" }), _jsx("div", { className: TEXT, children: "Couldn't load activity" }), _jsx("div", { className: `max-w-md ${CAPTION}`, children: msg }), _jsxs("div", { className: `max-w-md ${CAPTION}`, children: ["Make sure the hermes-activity plugin is enabled for this profile: ", _jsx("code", { children: "hermes plugins enable hermes-activity" })] }), _jsx("button", { className: "mt-2 text-[0.75rem] text-(--ui-accent) hover:underline", onClick: () => void q.refetch(), type: "button", children: "Retry" })] }));
        }
        return shell(_jsxs("div", { className: "flex flex-col gap-5", children: [_jsx("div", { className: "grid grid-cols-2 gap-4 sm:grid-cols-4", children: Array.from({ length: 8 }, (_, i) => (_jsx(Skeleton, { className: "h-10" }, i))) }), _jsx(Skeleton, { className: "h-32" }), _jsx(Skeleton, { className: "h-40" })] }));
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
    return shell(_jsxs("div", { className: "flex flex-col gap-7", children: [_jsxs("div", { className: "grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4", children: [_jsx(Stat, { label: "Total tokens", value: compact(total), hint: "incl. cache" }), _jsx(Stat, { label: "Input", value: compact(t.input_tokens), hint: `${compact(t.cache_read_tokens)} cache read` }), _jsx(Stat, { label: "Output", value: compact(t.output_tokens), hint: `${compact(t.reasoning_tokens)} reasoning` }), _jsx(Stat, { label: "Most used model", value: top ? top.model : "—", hint: top ? `${topShare.toFixed(0)}% of tokens${top.provider ? ` · ${top.provider}` : ""}` : undefined }), _jsx(Stat, { label: "Sessions", value: compact(t.sessions), hint: `${compact(t.subagent_sessions)} subagent · ${compact(t.messages)} msgs` }), _jsx(Stat, { label: "Tool calls", value: compact(t.tool_calls), hint: `${compact(t.api_calls)} API calls` }), _jsx(Stat, { label: "Est. cost", value: t.cost_usd > 0 ? money(t.cost_usd) : "—", hint: unpriced ? `${unpriced} model${unpriced === 1 ? "" : "s"} unpriced` : "all models priced" }), _jsx(Stat, { label: "Streak", value: plural(st.current, "day"), hint: `longest ${st.longest} · ${st.activeDays} active days` })] }), _jsxs(Section, { title: `${metricLabel(gridTotal, metric)} ${rangeLabel}`, trailing: _jsx(SegmentedControl, { onChange: (m) => {
                        setMetric(m);
                        CTX?.storage.set("metric", m);
                    }, options: METRICS, value: metric }), children: [_jsx(ContributionGrid, { data: data.daily, end: data.range.end, metric: metric, onSelect: setSelected, selected: selected, start: data.range.start }), _jsxs("div", { className: "mt-2 flex items-center justify-between gap-3", children: [_jsx("span", { className: "text-[0.6rem] text-(--ui-text-tertiary)", children: noActivity ? "No sessions in this range yet." : "Days use local time, by session start. Click a day for its sessions." }), _jsx(Legend, {})] })] }), selected && (_jsx(Section, { title: `${prettyDay(selected)}`, trailing: _jsx(IconButton, { icon: "close", label: "Close day", onClick: () => setSelected(null) }), children: dayQ.isLoading ? (_jsx(Skeleton, { className: "h-16" })) : dayQ.error ? (_jsx("div", { className: CAPTION, children: dayQ.error instanceof Error ? dayQ.error.message : String(dayQ.error) })) : (_jsx(SessionRows, { empty: "No sessions started that day.", sessions: dayQ.data?.sessions ?? [] })) })), _jsxs("div", { className: "grid gap-x-8 gap-y-7 sm:grid-cols-2", children: [_jsx(Section, { title: "Token mix", children: _jsx(TokenMix, { t: t }) }), _jsx(Section, { title: "Models", children: _jsx(List, { empty: "No model usage in this range.", rows: data.models.slice(0, 8).map((m) => ({
                                key: `${m.model}::${m.provider ?? ""}`,
                                label: m.model,
                                value: compact(tokensOf(m)),
                                hint: plural(m.sessions + m.subagent_sessions, "session"),
                            })) }) }), _jsx(Section, { title: "Top tools", children: _jsx(List, { empty: "No tool calls in this range.", rows: data.tools.slice(0, 8).map((x) => ({ key: x.tool, label: x.tool, value: compact(x.count) })) }) }), _jsx(Section, { title: "Top skills", children: _jsx(List, { empty: "No skills used in this range.", rows: (data.skills.top_skills ?? []).slice(0, 8).map((x) => ({ key: x.skill, label: x.skill, value: plural(x.total_count, "use") })) }) }), _jsx(Section, { title: "Platforms", children: _jsx(List, { empty: "No sessions in this range.", rows: data.sources.map((x) => ({ key: x.source, label: x.source, value: plural(x.sessions, "session"), hint: compact(x.tokens) })) }) }), _jsx(Section, { title: "When you work", children: _jsx(Punchcard, { rows: data.punchcard }) })] }), _jsx(Section, { title: "Notable sessions", children: _jsx(SessionRows, { empty: "No sessions in this range.", sessions: ["most_tokens", "most_messages", "most_tool_calls", "most_expensive"]
                        .map((k) => data.notable[k])
                        .filter((s, i, all) => !!s && all.findIndex((x) => x?.id === s.id) === i) }) }), _jsxs("div", { className: "text-[0.6rem] text-(--ui-text-tertiary)", children: ["hermes-activity v", WIDGET_VERSION, data.plugin_version !== WIDGET_VERSION ? ` · backend v${data.plugin_version} (reload desktop plugins to match)` : "", " \u00B7 read-only, local session store"] })] }));
}
// ───────────────────────────────────────────────────────────── status bar chip
const PREFIX = [ID];
function StatusChip() {
    const { scope, key } = useScope();
    useRefreshOnTurnEnd(PREFIX);
    const q = useQuery({
        queryKey: [...PREFIX, "today", key],
        queryFn: () => activityCli(scope, ["summary", "--days", "1", "--lite"]),
        staleTime: 5 * 60_000,
        retry: 0,
        refetchOnWindowFocus: false,
    });
    if (!q.data)
        return null; // stay invisible until we have a real number (or if the backend is off)
    const today = tokensOf(q.data.totals);
    return (_jsxs("button", { "aria-label": `Today: ${plural(today, "token")} · open Activity`, className: "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6875rem] text-(--ui-text-secondary) transition-colors hover:bg-(--chrome-action-hover)", onClick: () => host.navigate(ROUTE), title: `Today: ${plural(today, "token")}, ${plural(q.data.totals.sessions, "session")}`, type: "button", children: [_jsx(Codicon, { name: "graph" }), compact(today)] }));
}
// ───────────────────────────────────────────────────────────── registration
export default {
    id: ID,
    name: "Activity",
    register(ctx) {
        CTX = ctx;
        ctx.register({ id: "page", area: ROUTES_AREA, data: { path: ROUTE }, render: () => _jsx(ActivityPage, {}) });
        ctx.register({ id: "nav", area: SIDEBAR_NAV_AREA, order: 85, data: { path: ROUTE, label: "Activity", codicon: "graph" } });
        ctx.register({
            id: "open",
            area: PALETTE_AREA,
            data: { id: `${ID}.open`, label: "Open Activity", keywords: ["activity", "usage", "tokens", "insights", "contributions"], run: () => host.navigate(ROUTE) },
        });
        ctx.register({ id: "statusbar", area: STATUSBAR_AREAS.right, order: 130, render: () => _jsx(StatusChip, {}) });
    },
};
