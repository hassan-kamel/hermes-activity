import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, symlink, copyFile, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// A real `hermes activity provider-history` invocation against a hermetic
// HERMES_HOME (plugins symlinked in, cache pre-seeded) with no --refresh, so it
// must answer purely from the local archive and never touch the network.
async function hermeticHome():Promise<string>{
  const base=join(homedir(),".hermes/cache/scratch");
  await mkdir(base,{recursive:true});
  const home=await mkdtemp(join(base,"activity-cli-test-"));
  const realHome=process.env.HERMES_HOME||join(homedir(),".hermes");
  await symlink(join(realHome,"plugins"),join(home,"plugins"));
  const config=join(realHome,"config.yaml");
  if(existsSync(config))await copyFile(config,join(home,"config.yaml"));
  await writeFile(join(home,"activity_provider_history.json"),JSON.stringify({schema_version:1,checked_at:"2026-10-12T00:00:00Z",providers:{
    "opencode-go":{status:"available",scope:"workspace",source:"OpenCode v2 CSV export",data_as_of:"2026-10-11T00:00:00Z",reason:null,note:"",periods:[],fetched_at:"2026-10-11T00:00:00Z",scope_hash:"abc",daily:[{day:"2026-10-05",requests:3,tokens:300,input_tokens:100,output_tokens:200,cache_read_tokens:50,cache_write_tokens:null,reasoning_tokens:0,cost_usd:"0.1200"}]},
    "ollama":{status:"auth-required",scope:"account",source:"https://ollama.com/api/usage",data_as_of:null,reason:"no-credentials",note:"",periods:[],daily:[],fetched_at:null,scope_hash:""},
  }}));
  await writeFile(join(home,"quota_cache.json"),JSON.stringify({providers:{"opencode-go":{windows:[{label:"Monthly",used_percent:94,reset_at:null}]}}}));
  return home;
}

type EnvOverride={PATH?:string};

// Resolve the absolute `hermes` path up front so a stubbed PATH (for the
// missing-node case) cannot also hide the launcher we are testing.
function resolveHermes():string{
  for(const dir of (process.env.PATH||"").split(":")){
    if(dir){
      const candidate=join(dir,"hermes");
      if(existsSync(candidate))return candidate;
    }
  }
  throw new Error("hermes CLI not found on PATH");
}
const HERMES=resolveHermes();

function runCli(home:string,args:string[],env:EnvOverride={}):string{
  return execFileSync(HERMES,["activity","provider-history",...args],{
    env:{...process.env,HERMES_HOME:home,...env},
    encoding:"utf-8",
    timeout:120000,
  });
}

test("real CLI answers provider-history from cache with no --refresh",async()=>{
  const home=await hermeticHome();
  const stdout=runCli(home,["--days","365","--desktop","--json"]);
  const payload=JSON.parse(stdout);
  assert.equal(payload.schema_version,1);
  assert.equal(payload.scope,"provider-account");
  assert.equal(payload.provider_filter,"all");
  assert.equal(payload.range.days,365);
  assert.deepEqual(payload.daily,[]);
  assert.ok(Array.isArray(payload.providers)&&Array.isArray(payload.overview));
  const opencode=payload.overview.find((row:any)=>row.id==="opencode-go");
  assert.equal(opencode.status,"available");
  assert.equal(opencode.daily[0].tokens,300);
  assert.equal(opencode.daily[0].input_tokens,undefined,"desktop omits token components");
  assert.equal(opencode.breakdown.tokens,300,"breakdown is computed from full rows before compaction");
  assert.equal(opencode.breakdown.cost_usd,"0.12");
  assert.equal(opencode.windows[0].used_percent,94);
  assert.equal(payload.overview.find((row:any)=>row.id==="ollama").status,"auth-required");
  // The collector keeps its own archive and never writes Quota's.
  await assert.rejects(readFile(join(home,"provider_usage_history.json"),"utf-8"));
});

test("glue reports a missing node runtime explicitly instead of crashing",async()=>{
  const pluginRoot=resolve(dirname(fileURLToPath(import.meta.url)),"..");
  const linkParent=await mkdtemp(join(homedir(),".hermes/cache/scratch","activity-pkg-"));
  await symlink(pluginRoot,join(linkParent,"activity_pkg"));
  const emptyBin=await mkdtemp(join(homedir(),".hermes/cache/scratch","emptybin-"));
  const script=[
    "import json,os,sys",
    `os.environ['PATH']=${JSON.stringify(emptyBin)}`,
    `sys.path.insert(0,${JSON.stringify(linkParent)})`,
    "import activity_pkg.commands as c",
    "print(json.dumps(c.collect_provider_history(days=1,provider='all',refresh=False,desktop=True)))",
  ].join("\n");
  const stdout=execFileSync("python3",["-c",script],{encoding:"utf-8",timeout:60000});
  const payload=JSON.parse(stdout);
  assert.match(String(payload.error),/node runtime not found/i);
  assert.deepEqual(payload.overview,[]);
});
