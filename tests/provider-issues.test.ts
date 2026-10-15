import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { ollamaUsage } from '../scripts/provider-usage.ts';
import { collectActivityProviderHistory } from '../scripts/provider-history.ts';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const bucket = {from:'2026-10-13T00:00:00Z',until:'2026-10-14T00:00:00Z',request_count:2,input_tokens:10,cached_input_tokens:4,output_tokens:3,usage_usd:5e-7};
const payload = {range:'30d',scope:'self',granularity:'day',from:bucket.from,until:bucket.until,totals:{...bucket},buckets:[bucket]};

test('Ollama range response preserves dated counts, tiny costs and unknown metrics', () => {
  const usage = ollamaUsage(payload);
  assert.equal(usage.status,'available');
  assert.equal(usage.daily[0].day,'2026-10-13');
  assert.equal(usage.daily[0].tokens,13);
  assert.equal(usage.daily[0].cache_read_tokens,4);
  assert.equal(usage.daily[0].cache_write_tokens,null);
  assert.equal(usage.daily[0].cost_usd,'0.0000005');
  assert.equal(usage.periods[0].cost_usd,'0.0000005');
  assert.deepEqual(usage.periods[0].models,[]);
  assert.deepEqual(ollamaUsage({...payload,buckets:[]}).daily,[]);
  assert.equal(ollamaUsage({...payload,buckets:[]}).status,'summary-only');
  const unknown = ollamaUsage({...payload,buckets:[{from:bucket.from,until:bucket.until,request_count:0}]});
  assert.equal(unknown.daily[0].tokens,null);
  assert.equal(unknown.daily[0].requests,0);
});

test('Ollama rejects malformed or ambiguous buckets and costs', () => {
  for (const bad of [
    {...payload,granularity:'hour'},
    {...payload,buckets:[bucket,bucket]},
    {...payload,buckets:[{...bucket,from:'bad-date'}]},
    {...payload,buckets:[{...bucket,request_count:-1}]},
    {...payload,totals:{usage_usd:Infinity}},
    {...payload,totals:{usage_usd:-1}},
    {...payload,totals:{usage_usd:'5e-7'}},
  ]) assert.throws(()=>ollamaUsage(bad));
  assert.equal(ollamaUsage({activity:{cost:'0.1',models:[]}}).status,'summary-only');
});

test('Ollama refresh asks for 30 days and retains dated cache history without credentials', async () => {
  const base=join(homedir(),'.hermes/cache/scratch');
  await mkdir(base,{recursive:true});
  const home=await mkdtemp(join(base,'activity-issues-'));
  let calls=0;
  const out=await collectActivityProviderHistory({home,days:365,provider:'ollama',refresh:true,env:{OLLAMA_API_KEY:'fixture-only'},fetch:async(input)=>{
    calls++;
    assert.equal(String(input),'https://ollama.com/api/usage?range=30d');
    return Response.json(payload);
  }});
  assert.equal(calls,1);
  assert.equal(out.overview[0].status,'available');
  assert.equal(out.overview[0].daily[0].tokens,13);
  const cache=await readFile(join(home,'plugin-data/hermes-activity/activity_provider_history.json'),'utf8');
  assert.ok(!cache.includes('fixture-only'));
  const cached=await collectActivityProviderHistory({home,days:365,provider:'ollama',refresh:false,fetch:async()=>{throw Error('network forbidden');}});
  assert.equal(cached.overview[0].daily[0].tokens,13);
  const next={...payload,from:bucket.until,until:'2026-10-15T00:00:00Z',buckets:[{...bucket,from:bucket.until,until:'2026-10-15T00:00:00Z'}]};
  const refreshed=await collectActivityProviderHistory({home,days:365,provider:'ollama',refresh:true,env:{OLLAMA_API_KEY:'fixture-only'},fetch:async()=>Response.json(next)});
  assert.deepEqual(refreshed.overview[0].daily.map(row=>row.day),['2026-10-13','2026-10-14']);
});

test('Python launcher preserves only explicit Windows essentials, not arbitrary environment or stderr', () => {
  const script = `import ast,json,os,types
from pathlib import Path
from unittest.mock import patch
source=Path('commands.py').read_text()
tree=ast.parse(source)
fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='collect_provider_history')
import shutil,subprocess
ns={'Path':Path,'__file__':str(Path('commands.py').resolve()),'shutil':shutil,'subprocess':subprocess,'os':os,'json':json,'_hermes_home':lambda:'/profile','_CACHED_TIMEOUT_S':5,'_REFRESH_TIMEOUT_S':5}
exec(compile(ast.Module(body=[fn],type_ignores=[]),'commands.py','exec'),ns)
parent={'PATH':'runtime','SystemRoot':'C:\\Windows','WINDIR':'C:\\Windows','COMSPEC':'cmd.exe','TEMP':'scratch','TMP':'scratch','PATHEXT':'.EXE','SYSTEMDRIVE':'C:','UNRELATED_SETTING':'private','NODE_OPTIONS':'--bad-option','UNDECLARED_API_KEY':'private'}
def run(*args,**kw):
    env=kw['env']
    for name in ('SystemRoot','WINDIR','COMSPEC','TEMP','TMP','PATHEXT','SYSTEMDRIVE'): assert env.get(name)==parent[name], name
    assert not any(name in env for name in ('UNRELATED_SETTING','NODE_OPTIONS','UNDECLARED_API_KEY'))
    assert env['HERMES_HOME']=='/profile'
    return types.SimpleNamespace(returncode=1,stdout='',stderr='private')
with patch.dict(os.environ,parent,clear=True),patch.object(shutil,'which',return_value='node'),patch.object(subprocess,'run',side_effect=run):
    result=ns['collect_provider_history'](days=1)
    assert result=={'error':'provider history collector failed','overview':[]}
print('ok')`;
  assert.equal(execFileSync('python3',['-c',script],{encoding:'utf8'}).trim(),'ok');
});
