import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { collectActivityProviderHistory } from '../scripts/provider-history.ts';
import { parseProviderHistory } from '../src/provider-history.ts';

test('annual provider payload preserves all dates under desktop transport cap', async () => {
  const scratch=join(homedir(),'.hermes/cache/scratch');
  await mkdir(scratch,{recursive:true});
  const home=await mkdtemp(join(scratch,'activity-cap-'));
  try {
    const daily=Array.from({length:365},(_,index)=>({
      day:new Date(Date.UTC(2025,9,13+index)).toISOString().slice(0,10),
      requests:null,tokens:123456789,input_tokens:null,output_tokens:null,
      cache_read_tokens:null,cache_write_tokens:null,reasoning_tokens:null,cost_usd:null,
    }));
    const source={status:'available',scope:'account',source:'test-fixture',data_as_of:null,
      reason:null,note:'',periods:[],fetched_at:'2026-10-12T00:00:00Z',scope_hash:'fixture'};
    await writeFile(join(home,'activity_provider_history.json'),JSON.stringify({providers:{
      'openai-codex':{...source,daily},
      'opencode-go':{...source,daily:daily.slice(-90).map(row=>({...row,requests:1234,cost_usd:'123.12345678'}))},
    }}));
    const output=await collectActivityProviderHistory({home,days:365,provider:'all',refresh:false,desktop:true,now:new Date('2026-10-12T12:00:00Z')});
    assert.ok(Buffer.byteLength(JSON.stringify(output))<48000);
    const parsed=parseProviderHistory(output);
    assert.equal(parsed.overview.find(row=>row.id==='openai-codex')?.daily.length,365);
    assert.equal(parsed.overview.find(row=>row.id==='opencode-go')?.daily.length,90);
    assert.equal(parsed.overview.find(row=>row.id==='openai-codex')?.daily[0].input_tokens,null);
  } finally { await rm(home,{recursive:true,force:true}); }
});
