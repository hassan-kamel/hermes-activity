import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { collectActivityProviderHistory } from "../scripts/provider-history.ts";

async function fixture(){
  const base=join(homedir(),".hermes/cache/scratch");
  await mkdir(base,{recursive:true});
  const home=await mkdtemp(join(base,"activity-provider-history-test-"));
  await writeFile(join(home,"quota_cache.json"),JSON.stringify({fetched_at:"2026-10-12T00:00:00Z",providers:{"commandcode":{windows:[],unavailable_reason:null},"opencode-go":{windows:[{label:"Monthly",used_percent:94,reset_at:null}],unavailable_reason:null},"openai-codex":{plan:"Plus",windows:[],unavailable_reason:null},"ollama":{windows:[],unavailable_reason:"no-credentials"}}}));
  return home;
}

test("cached invocation needs no network and emits the Activity provider-history schema",async()=>{
  const home=await fixture();
  const out=await collectActivityProviderHistory({home,userHome:home,env:{},days:365,provider:"all",refresh:false,desktop:true,fetch:async()=>{throw new Error("must not fetch");}});
  assert.equal(out.schema_version,1);
  assert.equal(out.scope,"provider-account");
  assert.equal(out.provider_filter,"all");
  assert.deepEqual(out.daily,[]);
  assert.ok(Array.isArray(out.providers)&&out.providers.length>=4);
  assert.ok(out.providers.every(p=>typeof p.id==="string"&&typeof p.supported==="boolean"&&typeof p.has_history==="boolean"));
  const ids=out.overview.map(p=>p.id);
  assert.ok(ids.includes("commandcode")&&ids.includes("opencode-go")&&ids.includes("openai-codex")&&ids.includes("ollama"));
  assert.equal(out.overview.find(p=>p.id==="ollama")?.status,"auth-required");
  assert.equal(out.overview.find(p=>p.id==="commandcode")?.status,"not-collected");
  assert.equal(out.overview.find(p=>p.id==="opencode-go")?.windows[0].used_percent,94);
  assert.equal(out.range.days,365);
});

test("desktop output keeps a breakdown computed from the full filtered daily rows",async()=>{
  const home=await fixture();
  await writeFile(join(home,"activity_provider_history.json"),JSON.stringify({schema_version:1,checked_at:"2026-10-12T00:00:00Z",providers:{"opencode-go":{status:"available",scope:"workspace",source:"OpenCode v2 CSV export",data_as_of:"2026-10-11T00:00:00Z",reason:null,note:"",periods:[],fetched_at:"2026-10-11T00:00:00Z",scope_hash:"abc",daily:[{day:"2026-10-05",requests:3,tokens:300,input_tokens:100,output_tokens:200,cache_read_tokens:50,cache_write_tokens:null,reasoning_tokens:0,cost_usd:"0.1200"}]}}}));
  const out=await collectActivityProviderHistory({home,userHome:home,env:{},days:365,provider:"opencode-go",refresh:false,desktop:true,fetch:async()=>{throw new Error("must not fetch");}});
  const record=out.overview.find(p=>p.id==="opencode-go")!;
  assert.equal(record.daily[0].tokens,300);
  assert.equal(record.daily[0].input_tokens,undefined);
  assert.equal(record.breakdown.tokens,300);
  assert.equal(record.breakdown.input_tokens,100);
  assert.equal(record.breakdown.output_tokens,200);
  assert.equal(record.breakdown.cache_read_tokens,50);
  assert.equal(record.breakdown.requests,3);
  assert.equal(record.breakdown.cost_usd,"0.12");
  assert.equal(record.breakdown.active_days,1);
  assert.ok(out.providers.find(p=>p.id==="opencode-go")?.has_history);
});

test("refresh normalizes real sources and never persists credentials or identity",async()=>{
  const home=await fixture();
  await mkdir(join(home,".commandcode"),{recursive:true});
  await writeFile(join(home,".commandcode/auth.json"),JSON.stringify({apiKey:"synthetic-commandcode-secret"}));
  await writeFile(join(home,".env"),"OPENCODE_GO_API_KEY=synthetic-opencode-secret\n");
  await writeFile(join(home,"auth.json"),JSON.stringify({credential_pool:{"openai-codex":[{access_token:"synthetic-codex-secret",account_id:"private-account",priority:0}]}}));
  let codexTokens=100;
  const urls:string[]=[];
  const fetcher:typeof fetch=async(input)=>{
    const url=String(input);urls.push(url);
    if(url.includes("/wham/profiles/me"))return Response.json({profile:{username:"private-person"},stats:{daily_usage_buckets:[{start_date:"2026-10-11",tokens:codexTokens}]},metadata:{stats_as_of:"2026-10-11"}});
    if(url.includes("/console/api/v2/usage/export"))return new Response("day,user_type,user_id,user_name,provider,model,requests,input_tokens,output_tokens,cache_read_tokens,cache_write_5m_tokens,cache_write_1h_tokens,cost_micro_cents\n2026-10-11,member,private-id,Private,openai,model-a,1,10,5,0,0,0,1000000\n");
    if(url.includes("/alpha/whoami"))return Response.json({org:{id:"private-org"}});
    if(url.includes("/alpha/billing/subscriptions"))return Response.json({data:null});
    if(url.includes("/alpha/usage/summary"))return Response.json({totalCost:11.43,totalCount:1076,totalTokens:157290712,periodBasis:"last-30-days"});
    throw new Error("unexpected endpoint");
  };
  const options={home,userHome:home,env:{},days:30,provider:"all",refresh:true,fetch:fetcher,now:new Date("2026-10-12T00:45:00Z")};
  const first=await collectActivityProviderHistory(options);
  assert.equal(first.overview.find(p=>p.id==="commandcode")?.periods[0].requests,1076);
  assert.equal(first.overview.find(p=>p.id==="opencode-go")?.daily[0].tokens,15);
  assert.equal(first.overview.find(p=>p.id==="openai-codex")?.daily[0].tokens,100);
  assert.equal(first.overview.find(p=>p.id==="ollama")?.status,"auth-required");
  codexTokens=130;
  const second=await collectActivityProviderHistory(options);
  assert.equal(second.overview.find(p=>p.id==="openai-codex")?.daily[0].tokens,130);
  const saved=await readFile(join(home,"activity_provider_history.json"),"utf8");
  for(const text of [saved,JSON.stringify(second)]){
    assert.ok(!text.includes("synthetic-"));
    assert.ok(!text.includes("private-person"));
    assert.ok(!text.includes("private-id"));
    assert.ok(!text.includes("private-account"));
    assert.ok(!text.includes("private-org"));
  }
  assert.ok(urls.every(url=>url.startsWith("https://api.commandcode.ai/")||url.startsWith("https://chatgpt.com/")||url.startsWith("https://opencode.ai/")));
  await assert.rejects(readFile(join(home,"provider_usage_history.json"),"utf8"));
});
