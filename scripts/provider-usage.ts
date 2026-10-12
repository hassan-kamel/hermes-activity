/*
 * Genuine provider source adapters, copied from the Quota plugin's
 * `scripts/provider-usage.ts` and kept verbatim so the Activity plugin owns its
 * own copy instead of importing across plugins. Each function normalises one
 * provider's real API payload into the shared UsageSource shape; nothing here
 * touches the network or the local cache.
 *
 * Upstream: Quota plugin, MIT License, Copyright (c) 2026 rarf.
 * Adapted locally for Hermes Activity. See THIRD_PARTY_NOTICES.md.
 */
export interface UsageDay {
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
export interface UsageModel {
  model: string;
  requests: number | null;
  tokens: number | null;
  cost_usd: string | null;
}
export interface UsagePeriod {
  label: string;
  basis: string;
  start: string | null;
  end: string | null;
  requests: number | null;
  tokens: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: string | null;
  models: UsageModel[];
}
export interface UsageSource {
  status: 'available' | 'summary-only' | 'auth-required' | 'unavailable' | 'not-collected' | 'not-integrated';
  scope: string;
  source: string;
  data_as_of: string | null;
  reason: string | null;
  note: string;
  periods: UsagePeriod[];
  daily: UsageDay[];
}
function record(value: unknown): Record<string,any> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid provider response');
  return value;
}
function integer(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0) throw new Error('Invalid provider count');
  return number;
}
function decimal(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) || !Number.isFinite(Number(text))) throw new Error('Invalid provider amount');
  return text;
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value+'T00:00:00Z')) || new Date(value+'T00:00:00Z').toISOString().slice(0,10) !== value) throw new Error('Invalid provider date');
  return value;
}
function timestamp(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('Invalid provider timestamp');
  return value;
}
function blankDay(day: string): UsageDay {
  return {day,requests:null,tokens:null,input_tokens:null,output_tokens:null,cache_read_tokens:null,cache_write_tokens:null,reasoning_tokens:null,cost_usd:null};
}
function blankPeriod(label: string, basis: string): UsagePeriod {
  return {label,basis,start:null,end:null,requests:null,tokens:null,input_tokens:null,output_tokens:null,cost_usd:null,models:[]};
}
function source(scope: string, path: string, note: string): UsageSource {
  return {status:'summary-only',scope,source:path,data_as_of:null,reason:null,note,periods:[],daily:[]};
}
export function commandCodeUsage(payload: unknown, subscription: unknown): UsageSource {
  const value = record(payload);
  const sub = subscription && typeof subscription === 'object' ? record(subscription) : {};
  const basis = typeof value.periodBasis === 'string' ? value.periodBasis : 'unspecified-period';
  const label = basis === 'last-30-days' ? 'Last 30 days' : basis === 'billing-period' ? 'Current billing period' : 'Provider-reported period';
  const period = blankPeriod(label,basis);
  period.requests = integer(value.totalCount);
  period.tokens = integer(value.totalTokens);
  period.input_tokens = integer(value.totalTokensIn);
  period.output_tokens = integer(value.totalTokensOut);
  period.cost_usd = decimal(value.totalCost);
  if (basis === 'billing-period') {
    period.start = timestamp(sub.currentPeriodStart);
    period.end = timestamp(sub.currentPeriodEnd);
  }
  const result = source('organization','https://api.commandcode.ai/alpha/usage/summary','These are provider-reported period totals, not a daily timeline. Studio has per-request history, but no verified dated-history adapter is connected.');
  if ([period.requests,period.tokens,period.cost_usd].every(n=>n===null)) throw new Error('Invalid provider summary');
  result.periods = [period];
  return result;
}
export function codexUsage(payload: unknown): UsageSource {
  const value = record(payload);
  const stats = record(value.stats);
  const result = source('account','https://chatgpt.com/backend-api/wham/profiles/me','Provider-reported Codex token activity for the primary saved account. No account totals are combined. Daily buckets can lag; missing days and missing costs are not zero.');
  const metadata = value.metadata && typeof value.metadata === 'object' ? record(value.metadata) : {};
  result.data_as_of = timestamp(metadata.stats_as_of);
  if (metadata.stats_error) { result.status='unavailable'; result.reason='provider-stats-error'; return result; }
  const lifetime = integer(stats.lifetime_tokens);
  if (lifetime !== null) { const p=blankPeriod('Lifetime token activity','lifetime'); p.tokens=lifetime; result.periods=[p]; }
  if (stats.daily_usage_buckets === undefined || stats.daily_usage_buckets === null) { result.status='summary-only'; return result; }
  if (!Array.isArray(stats.daily_usage_buckets)) throw new Error('Invalid provider daily buckets');
  result.daily = stats.daily_usage_buckets.map((raw:unknown)=> {
    const row = record(raw);
    const entry=blankDay(date(row.start_date));
    entry.tokens=integer(row.tokens);
    if (entry.tokens===null) throw new Error('Invalid provider token bucket');
    return entry;
  });
  if (new Set(result.daily.map(r=>r.day)).size!==result.daily.length) throw new Error('Invalid duplicate provider day');
  result.daily.sort((a,b)=>a.day.localeCompare(b.day));
  result.status='available';
  return result;
}
function csvRows(text: string): string[][] {
  const rows: string[][]=[];
  let row: string[]=[], field='', quoted=false;
  for (let i=0;i<text.length;i++) {
    const c=text[i];
    if (quoted) {
      if (c==='"' && text[i+1]==='"') {field+='"';i++;}
      else if (c==='"') quoted=false;
      else field+=c;
    } else if (c==='"' && field==='') quoted=true;
    else if (c===',') {row.push(field);field='';}
    else if (c==='\n') {row.push(field.replace(/\r$/,''));if (row.some(Boolean)) rows.push(row);row=[];field='';}
    else field+=c;
  }
  if (quoted) throw new Error('Invalid unterminated CSV');
  if (field || row.length) {row.push(field.replace(/\r$/,''));if(row.some(Boolean))rows.push(row);}
  return rows;
}
function usd(microcents: bigint): string {
  const whole=microcents/100_000_000n;
  const remainder=(microcents%100_000_000n).toString().padStart(8,'0').replace(/0+$/,'');
  return whole.toString()+(remainder ? '.'+remainder : '');
}
export function openCodeUsage(csv: string, days=90, now=new Date()): UsageSource {
  if (![7,30,90].includes(days)) throw new Error('Invalid OpenCode export range');
  const rows=csvRows(csv.replace(/^\uFEFF/,''));
  const headers=rows.shift() || [];
  const required=['day','provider','model','requests','input_tokens','output_tokens','cache_read_tokens','cache_write_5m_tokens','cache_write_1h_tokens','cost_micro_cents'];
  if (!required.every(h=>headers.includes(h)) || new Set(headers).size!==headers.length) throw new Error('Invalid OpenCode CSV headers');
  const aggregate=new Map<string,{row:UsageDay,cost:bigint}>();
  const models=new Map<string,{row:UsageModel,cost:bigint}>();
  for (const cells of rows) {
    if (cells.length!==headers.length) throw new Error('Invalid OpenCode CSV row');
    const r=Object.fromEntries(headers.map((h,i)=>[h,cells[i]]));
    const day=date(r.day);
    const metric=blankDay(day);
    metric.requests=integer(r.requests);
    metric.input_tokens=integer(r.input_tokens);
    metric.output_tokens=integer(r.output_tokens);
    metric.cache_read_tokens=integer(r.cache_read_tokens);
    const five=integer(r.cache_write_5m_tokens), hour=integer(r.cache_write_1h_tokens);
    metric.cache_write_tokens=five!==null && hour!==null ? five+hour : null;
    const tokenParts=[metric.input_tokens,metric.output_tokens,metric.cache_read_tokens,metric.cache_write_tokens];
    metric.tokens=tokenParts.every(v=>v!==null) ? tokenParts.reduce<number>((n,v)=>n+(v??0),0) : null;
    if (!/^\d+$/.test(r.cost_micro_cents)) throw new Error('Invalid OpenCode microcents');
    const cost=BigInt(r.cost_micro_cents);
    metric.cost_usd=usd(cost);
    const existing=aggregate.get(day);
    if (!existing) aggregate.set(day,{row:metric,cost});
    else {
      for (const field of ['requests','tokens','input_tokens','output_tokens','cache_read_tokens','cache_write_tokens'] as const) {
        const a=existing.row[field],b=metric[field];existing.row[field]=a!==null && b!==null ? a+b : null;
      }
      existing.cost+=cost;existing.row.cost_usd=usd(existing.cost);
    }
    const model=r.provider+'/'+r.model;
    const previous=models.get(model);
    if (!previous) models.set(model,{row:{model,requests:metric.requests,tokens:metric.tokens,cost_usd:metric.cost_usd},cost});
    else { previous.row.requests=previous.row.requests!==null && metric.requests!==null ? previous.row.requests+metric.requests : null; previous.row.tokens=previous.row.tokens!==null && metric.tokens!==null ? previous.row.tokens+metric.tokens : null; previous.cost+=cost;previous.row.cost_usd=usd(previous.cost); }
  }
  const result=source('workspace','https://opencode.ai/console/api/v2/usage/export','Workspace-wide OpenCode Go / Zen export, grouped by UTC day, not Hermes-only. Provider rollups can lag. Each API read covers at most 90 days; earlier captured daily buckets are retained without estimating missing days.');
  result.status='available';
  result.daily=[...aggregate.values()].map(a=>a.row).sort((a,b)=>a.day.localeCompare(b.day));
  const p=blankPeriod(`Last ${days} UTC days`,`export-${days}d`);
  const end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1));
  const start=new Date(end);start.setUTCDate(start.getUTCDate()-days);
  p.start=start.toISOString();p.end=end.toISOString();
  for (const field of ['requests','tokens','input_tokens','output_tokens'] as const) {
    p[field]=result.daily.every(r=>r[field]!==null) ? result.daily.reduce((total,r)=>total+(r[field]??0),0) : null;
  }
  p.cost_usd=usd([...aggregate.values()].reduce((sum,a)=>sum+a.cost,0n));
  p.models=[...models.values()].map(a=>a.row).sort((a,b)=>a.model.localeCompare(b.model));
  result.periods=[p];
  return result;
}
export function ollamaUsage(payload: unknown): UsageSource {
  const value=record(payload), activity=record(value.activity);
  const reported=activity.period && typeof activity.period==='object' ? record(activity.period) : {};
  const basis=typeof reported.type==='string' ? reported.type : 'unspecified-period';
  const p=blankPeriod(basis.replace(/_/g,' '),basis);
  p.cost_usd=decimal(activity.cost);
  p.start=timestamp(reported.starting_at);p.end=timestamp(reported.ending_at);
  const modelRows=activity.models===undefined ? [] : activity.models;
  if(!Array.isArray(modelRows))throw new Error('Invalid Ollama models');
  p.models=modelRows.map((raw:unknown)=>{const m=record(raw);if(typeof m.name!=='string'||!m.name)throw new Error('Invalid Ollama model');return {model:m.name,requests:integer(m.request_count),tokens:null,cost_usd:decimal(m.cost)};});
  p.requests=p.models.length && p.models.every(m=>m.requests!==null) ? p.models.reduce((n,m)=>n+(m.requests??0),0) : null;
  const result=source('account','https://ollama.com/api/usage','API-reported activity period and per-model requests only. Monthly quota counters are separate and are not added here. This is not a full per-request or pay-as-you-go charge ledger.');
  if(p.cost_usd===null && !p.models.length)throw new Error('Invalid Ollama usage response');
  result.periods=[p];return result;
}
export function mergeDaily(oldRows: UsageDay[], newRows: UsageDay[]): UsageDay[] {
  return [...new Map([...oldRows,...newRows].map(r=>[r.day,r])).values()].sort((a,b)=>a.day.localeCompare(b.day));
}
