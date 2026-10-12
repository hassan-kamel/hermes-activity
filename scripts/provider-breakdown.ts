/*
 * Provider breakdown aggregation, copied verbatim from the Quota plugin's
 * `scripts/provider-breakdown.ts`. Sums a set of dated usage rows into the
 * window totals the Activity page renders (exact decimal-string cost addition,
 * null-preserving metrics, active/reported day counts).
 *
 * Upstream: Quota plugin, MIT License, Copyright (c) 2026 rarf.
 * Adapted locally for Hermes Activity. See THIRD_PARTY_NOTICES.md.
 */
import type { UsageDay } from './provider-usage.ts';

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

export function dailyBreakdown(rows: UsageDay[]): ProviderBreakdown {
  const sum = (field: keyof UsageDay): number | null => {
    const values = rows.map(row => row[field]).filter((value): value is number => typeof value === 'number');
    if (!values.length) return null;
    const total = values.reduce((result, value) => result + value, 0);
    if (!Number.isSafeInteger(total)) throw new Error('Invalid breakdown total');
    return total;
  };
  const costs = rows.map(row => row.cost_usd).filter((value): value is string => value !== null);
  let cost: string | null = null;
  if (costs.length) {
    if (costs.some(value => !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))) throw new Error('Invalid breakdown cost');
    const scale = Math.max(...costs.map(value => (value.split('.')[1] ?? '').length));
    const total = costs.reduce((result, value) => {
      const [whole, fraction = ''] = value.split('.');
      return result + BigInt(whole + fraction.padEnd(scale, '0'));
    }, 0n);
    const digits = total.toString().padStart(scale + 1, '0');
    const fraction = scale ? digits.slice(-scale).replace(/0+$/, '') : '';
    cost = scale ? digits.slice(0, -scale) + (fraction ? '.' + fraction : '') : digits;
  }
  return {
    tokens: sum('tokens'),
    input_tokens: sum('input_tokens'),
    output_tokens: sum('output_tokens'),
    cache_read_tokens: sum('cache_read_tokens'),
    cache_write_tokens: sum('cache_write_tokens'),
    reasoning_tokens: sum('reasoning_tokens'),
    requests: sum('requests'),
    cost_usd: cost,
    active_days: new Set(rows.filter(row => [row.tokens, row.requests, row.cost_usd === null ? null : Number(row.cost_usd)].some(value => value !== null && value > 0)).map(row => row.day)).size,
    reported_days: new Set(rows.map(row => row.day)).size,
  };
}
