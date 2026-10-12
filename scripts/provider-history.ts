/*
 * Hermes Activity provider-history collector.
 *
 * Adapted from the Quota plugin's `scripts/provider-history.ts` (MIT License,
 * Copyright (c) 2026 rarf — see THIRD_PARTY_NOTICES.md). Differences from the
 * upstream collector, all deliberate:
 *
 *  • Emits the Hermes Activity provider-history contract
 *    (schema_version / scope / range / provider_filter / providers / daily /
 *    overview) instead of Quota's quota-window payload. The real per-provider
 *    `overview` records are authoritative; the legacy top-level `daily` array is
 *    present but empty.
 *  • Persists to Activity's own cache file `activity_provider_history.json`
 *    (never Quota's `provider_usage_history.json`).
 *  • May OPTIONALLY read `quota_cache.json` for display-only quota windows and
 *    plan labels, but never imports the Quota backend.
 *  • In desktop mode computes each provider's `breakdown` from the filtered FULL
 *    daily rows first, then drops the token-component fields from the projected
 *    daily rows.
 *
 * Credentials are read only to authenticate a live fetch; they are never written
 * to the cache and never appear in stdout.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandCodeUsage, codexUsage, openCodeUsage, ollamaUsage, mergeDaily, type UsageSource, type UsageDay } from './provider-usage.ts';
import { dailyBreakdown, type ProviderBreakdown } from './provider-breakdown.ts';

const SOURCES:Record<string,{scope:string,source:string,note:string}>={
  commandcode:{scope:'organization',source:'https://api.commandcode.ai/alpha/usage/summary',note:'Provider-reported period totals. Dated Studio request history is not connected.'},
  'opencode-go':{scope:'workspace',source:'https://opencode.ai/console/api/v2/usage/export',note:'OpenCode workspace daily usage export needs usage-read Console access. Go inference quota is a separate surface.'},
  'openai-codex':{scope:'account',source:'https://chatgpt.com/backend-api/wham/profiles/me',note:'Primary saved Codex account, provider-reported daily token activity. No account totals are combined.'},
  ollama:{scope:'account',source:'https://ollama.com/api/usage',note:'Ollama activity-period totals, not a daily request ledger.'},
};
interface Window {label:string;used_percent:number|null;reset_at:string|null}
interface Overview extends UsageSource { id:string;fetched_at:string|null;windows:Window[];plan:string|null;breakdown:ProviderBreakdown }
interface SavedRecord extends UsageSource { fetched_at:string;scope_hash:string }
interface Options {home:string;days:number;provider:string;refresh:boolean;desktop?:boolean;userHome?:string;env?:NodeJS.ProcessEnv;fetch?:typeof fetch;now?:Date}
class ApiFailure extends Error {
  readonly reason: string;
  constructor(reason: string) { super(reason); this.reason = reason; }
}
async function readJson(path:string):Promise<any>{try{return JSON.parse(await readFile(path,'utf8'));}catch(error:any){if(error.code==='ENOENT')return {};throw new ApiFailure('invalid-local-cache');}}
async function readEnv(path:string):Promise<Record<string,string>>{
  const env:Record<string,string>={};
  let text='';try{text=await readFile(path,'utf8');}catch(error:any){if(error.code==='ENOENT')return env;throw new ApiFailure('credential-read-failed');}
  for(const line of text.split('\n')){const m=line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);if(m)env[m[1]]=m[2].replace(/^(["'])(.*)\1$/,'$2');}
  return env;
}
function digest(value:string){return createHash('sha256').update(value).digest('hex');}
function empty(id:string,status:UsageSource['status'],reason:string|null):UsageSource{
  const source=SOURCES[id]??{scope:'account',source:'Activity provider adapter',note:'A provider-history adapter is not connected. Existing quota windows do not establish a dated usage timeline.'};
  return {...source,status,reason,data_as_of:null,periods:[],daily:[]};
}
function windowsOf(record:any):Window[]{return Array.isArray(record?.windows)?record.windows.slice(0,32).map((w:any)=>({label:String(w.label||'Window').slice(0,100),used_percent:typeof w.used_percent==='number'&&Number.isFinite(w.used_percent)?w.used_percent:null,reset_at:typeof w.reset_at==='string'?w.reset_at:null})):[];}
function poolKey(auth:any,id:string,env:Record<string,string>):string{
  const rows=auth.credential_pool?.[id];
  if(!Array.isArray(rows))return '';
  const sorted=[...rows].sort((a,b)=>(typeof a?.priority==='number'?a.priority:Infinity)-(typeof b?.priority==='number'?b.priority:Infinity));
  for(const r of sorted){const direct=r?.api_key||r?.key;const value=typeof direct==='string'?direct:typeof r?.key_env==='string'?env[r.key_env]:'';if(value?.trim())return value.trim();}
  return '';
}
function claimsOf(token:string):any{try{return JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));}catch{return {};}}
async function readBounded(response:Response):Promise<string>{
  if(!response.body)return '';
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8*1024*1024){await reader.cancel();throw new ApiFailure('response-too-large');}chunks.push(value);}
  return Buffer.concat(chunks).toString('utf8');
}
async function get(url:string,key:string,fetcher:typeof fetch,deadline:number,extra:Record<string,string>={}):Promise<string>{
  const remaining=deadline-Date.now();if(remaining<=0)throw new ApiFailure('timeout');
  try{
    const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(Math.min(remaining,10000)),headers:{Authorization:`Bearer ${key}`,Accept:'application/json',...extra}});
    if(!response.ok){await response.body?.cancel();if(response.status===401)throw new ApiFailure('auth-failed');if(response.status===403)throw new ApiFailure('permission-denied');if(response.status===404)throw new ApiFailure('endpoint-not-available');if(response.status===429)throw new ApiFailure('rate-limited');throw new ApiFailure(`http-${response.status}`);}
    return await readBounded(response);
  }catch(error){if(error instanceof ApiFailure)throw error;throw new ApiFailure(error instanceof Error && (error.name==='TimeoutError'||error.name==='AbortError')?'timeout':'fetch-error');}
}
async function fetchSource(id:string,options:Options):Promise<{usage:UsageSource;scopeHash:string|null}>{
  const envFile=await readEnv(join(options.home,'.env'));
  const env={...envFile,...(options.env??process.env)} as Record<string,string>;
  const userHome=options.userHome??homedir();
  const fetcher=options.fetch??fetch;
  const deadline=Date.now()+30000;
  let scopeHash:string|null=null;
  try{
    if(id==='commandcode'){
      const local=await readJson(join(userHome,'.commandcode/auth.json'));
      const auth=typeof local.apiKey==='string'&&local.apiKey.trim()?{}:await readJson(join(options.home,'auth.json'));
      const key=typeof local.apiKey==='string'&&local.apiKey.trim()?local.apiKey.trim():env.COMMAND_CODE_API_KEY?.trim()||poolKey(auth,'commandcode',env);
      if(!key)throw new ApiFailure('no-credentials');scopeHash=digest(key);
      const identity=JSON.parse(await get('https://api.commandcode.ai/alpha/whoami?limits=1',key,fetcher,deadline));
      const org=typeof identity?.org?.id==='string'?identity.org.id:null;
      if(org)scopeHash=digest('commandcode:'+org);
      const query=new URLSearchParams();if(org)query.set('orgId',org);
      const subscription=JSON.parse(await get('https://api.commandcode.ai/alpha/billing/subscriptions?'+query,key,fetcher,deadline));
      const sub=subscription?.data??null;
      if(typeof sub?.currentPeriodStart==='string'&&sub.currentPeriodStart.trim())query.set('since',sub.currentPeriodStart.trim());
      const summary=JSON.parse(await get('https://api.commandcode.ai/alpha/usage/summary?'+query,key,fetcher,deadline));
      return {usage:commandCodeUsage(summary,sub),scopeHash};
    }
    if(id==='openai-codex'){
      const auth=await readJson(join(options.home,'auth.json'));
      const rows=auth.credential_pool?.['openai-codex'];
      const list=Array.isArray(rows)&&rows.length?rows:[auth.providers?.['openai-codex']?.tokens??auth.providers?.['openai-codex']??{}];
      const candidates=[...list].sort((a,b)=>(typeof a?.priority==='number'?a.priority:Infinity)-(typeof b?.priority==='number'?b.priority:Infinity));
      const first=candidates.find(r=>typeof r?.access_token==='string'&&r.access_token.trim());
      if(!first)throw new ApiFailure('no-credentials');
      let row=first;let claims=claimsOf(row.access_token);const actor=claims['https://api.openai.com/auth']?.chatgpt_account_id;
      if(typeof claims.exp==='number'&&claims.exp*1000<=Date.now()){
        const newer=candidates.find(r=>{if(typeof r?.access_token!=='string')return false;const c=claimsOf(r.access_token);return actor && c['https://api.openai.com/auth']?.chatgpt_account_id===actor&&c.sub===claims.sub&&typeof c.exp==='number'&&c.exp*1000>Date.now();});
        if(newer){row=newer;claims=claimsOf(row.access_token);}else throw new ApiFailure('reauth-required');
      }
      const key=row.access_token.trim();
      const account=typeof row.account_id==='string'?row.account_id:claims['https://api.openai.com/auth']?.chatgpt_account_id;
      scopeHash=digest(typeof account==='string'?'codex:'+account+':'+(claims.sub??''):key);
      const base=(typeof row.base_url==='string'&&row.base_url?row.base_url:'https://chatgpt.com/backend-api/codex').replace(/\/$/,'').replace(/\/codex$/,'');
      if(new URL(base).origin!=='https://chatgpt.com')throw new ApiFailure('custom-history-route-not-supported');
      const headers:Record<string,string>={'User-Agent':'codex-cli'};
      if(typeof account==='string')headers['ChatGPT-Account-Id']=account;
      const authClaims=claims['https://api.openai.com/auth'];const residency=authClaims?.chatgpt_data_residency||authClaims?.chatgpt_compute_residency;
      if(typeof residency==='string'&&residency.trim())headers['x-openai-internal-codex-residency']=residency.trim();
      return {usage:codexUsage(JSON.parse(await get(base+'/wham/profiles/me',key,fetcher,deadline,headers))),scopeHash};
    }
    if(id==='opencode-go'){
      const auth=await readJson(join(userHome,'.local/share/opencode/auth.json'));
      const local=auth['opencode-go']||auth.opencode||auth['opencode-zen']||auth.zen;
      const localKey=typeof local==='string'?local:local?.key||local?.apiKey||local?.api_key||local?.zenApiKey||local?.goApiKey;
      const key=env.OPENCODE_CONSOLE_API_KEY?.trim()||env.OPENCODE_API_KEY?.trim()||env.OPENCODE_GO_API_KEY?.trim()||(typeof localKey==='string'?localKey.trim():'');
      if(!key)throw new ApiFailure('no-credentials');scopeHash=digest(key);
      const csv=await get('https://opencode.ai/console/api/v2/usage/export?range=90d',key,fetcher,deadline,{Accept:'text/csv'});
      return {usage:openCodeUsage(csv,90,options.now),scopeHash};
    }
    if(id==='ollama'){
      const auth=await readJson(join(options.home,'auth.json'));
      const key=env.OLLAMA_API_KEY?.trim()||poolKey(auth,'ollama-cloud',env);
      if(!key)throw new ApiFailure('no-credentials');scopeHash=digest(key);
      return {usage:ollamaUsage(JSON.parse(await get('https://ollama.com/api/usage',key,fetcher,deadline))),scopeHash};
    }
    return {usage:empty(id,'not-integrated',null),scopeHash};
  }catch(error){
    const reason=error instanceof ApiFailure?error.reason:'invalid-provider-response';
    const auth=['no-credentials','auth-failed','reauth-required','permission-denied'].includes(reason);
    const usage=empty(id,auth?'auth-required':'unavailable',reason);
    if(id==='opencode-go'&&auth)usage.note='Usage export needs a Console key with usage:read access. A key that only supports inference can still show Go quota while history is denied.';
    return {usage,scopeHash};
  }
}

interface HistoryOptions {home:string;days:number;provider:string;refresh:boolean;desktop?:boolean;userHome?:string;env?:NodeJS.ProcessEnv;fetch?:typeof fetch;now?:Date}

/**
 * Collects the Hermes Activity provider-history payload.
 *
 * `overview` is authoritative: one record per provider with real source/scope,
 * periods, dated daily rows, a breakdown, and any quota windows (display only).
 * The legacy top-level `daily` array is always empty.
 */
export async function collectActivityProviderHistory(options:HistoryOptions):Promise<Record<string,any>>{
  if(!Number.isInteger(options.days)||options.days<1||options.days>365)throw new Error('days must be 1-365');
  const q=await readJson(join(options.home,'quota_cache.json'));
  const historyPath=join(options.home,'activity_provider_history.json');
  const stored=await readJson(historyPath);
  const records:Record<string,SavedRecord>=stored.providers&&typeof stored.providers==='object'?{...stored.providers}:{};
  const cacheIds=q.providers&&typeof q.providers==='object'?Object.keys(q.providers).filter(id=>!id.includes(':')):[];
  const ids=options.provider==='all'?[...new Set([...Object.keys(SOURCES),...cacheIds])]:[options.provider];
  const now=options.now??new Date();
  if(options.refresh){
    await Promise.all(ids.filter(id=>id in SOURCES).map(async id=>{
      const result=await fetchSource(id,options);
      const previous=records[id];
      const same=Boolean(previous&&result.scopeHash&&previous.scope_hash===result.scopeHash);
      const usage=result.usage;
      const success=usage.status==='available'||usage.status==='summary-only';
      if(success&&same&&previous){
        const cutoff=new Date(now);cutoff.setUTCDate(cutoff.getUTCDate()-400);
        usage.daily=mergeDaily(previous.daily??[],usage.daily).filter(r=>r.day>=cutoff.toISOString().slice(0,10));
      }
      if(!success&&same&&previous){usage.daily=previous.daily;usage.periods=previous.periods;usage.data_as_of=previous.data_as_of;usage.note+=' Last successfully fetched data is retained, not a fresh observation.';}
      records[id]={...usage,scope_hash:result.scopeHash??'',fetched_at:success?now.toISOString():same&&previous?previous.fetched_at:now.toISOString()};
    }));
    await mkdir(options.home,{recursive:true});
    const staging=historyPath+'.'+randomUUID()+'.tmp';
    await writeFile(staging,JSON.stringify({schema_version:1,checked_at:now.toISOString(),providers:records})+'\n',{mode:0o600});
    await rename(staging,historyPath);
  }
  const dayKey=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const end=new Date(now);const start=new Date(now);start.setDate(start.getDate()-options.days+1);
  const startDay=dayKey(start),endDay=dayKey(end);
  const overview:Overview[]=ids.map((id):Overview=>{
    const cache=q.providers?.[id];const saved=records[id];
    let value:UsageSource;
    if(saved)value={status:saved.status,scope:saved.scope,source:saved.source,data_as_of:saved.data_as_of,reason:saved.reason,note:saved.note,periods:saved.periods??[],daily:(saved.daily??[]).filter(r=>r.day>=startDay&&r.day<=endDay)};
    else {const reason=typeof cache?.unavailable_reason==='string'?cache.unavailable_reason:null;const isAuth=reason==='no-credentials'||reason==='reauth-required'||reason==='auth-failed';value=empty(id,isAuth?'auth-required':id in SOURCES?'not-collected':'not-integrated',reason);}
    return {id,...value,fetched_at:saved?.fetched_at??null,plan:typeof cache?.plan==='string'?cache.plan:null,windows:windowsOf(cache),breakdown:dailyBreakdown(value.daily)};
  });
  const providers=ids.map(id=>({id,supported:id in SOURCES,has_history:(records[id]?.daily??[]).some(r=>r.day>=startDay&&r.day<=endDay)}));
  let projected=overview;
  if(options.desktop){
    // Compute the breakdown from the filtered FULL daily rows (done above), then
    // drop the token-component fields the desktop page does not render.
    const compact=(row:UsageDay)=>({day:row.day,requests:row.requests,tokens:row.tokens,cost_usd:row.cost_usd});
    projected=overview.map(row=>({...row,daily:row.daily.map(compact)}));
  }
  return {
    schema_version:1,
    scope:'provider-account',
    range:{start:startDay,end:endDay,days:options.days},
    provider_filter:options.provider,
    providers,
    daily:[],
    overview:projected,
  };
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
  const args=process.argv.slice(2);
  const flag=(name:string)=>args.includes(name);
  const valueOf=(name:string,fallback:string):string=>{const i=args.indexOf(name);return i>=0&&args[i+1]?args[i+1]:fallback;};
  const positional=args.filter(a=>!a.startsWith('--'));
  const days=Number(positional[0]||valueOf('--days','365'));
  const provider=positional[1]||valueOf('--provider','all');
  const home=process.env.HERMES_HOME||join(homedir(),'.hermes');
  try{
    const result=await collectActivityProviderHistory({home,days,provider,refresh:flag('--refresh'),desktop:flag('--desktop')});
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch(error){
    process.stdout.write(JSON.stringify({overview:[],history_error:error instanceof Error?error.message:'Unable to read activity provider history cache'})+'\n');
    process.exitCode=1;
  }
}
