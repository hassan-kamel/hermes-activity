import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { collectActivityProviderHistory } from '../scripts/provider-history.ts';

test('glue uses public APIs only on refresh with an isolated child environment', async () => {
  const source = await readFile(new URL('commands.py', root), 'utf8');
  assert.ok(!source.includes('dict(os.environ)'));
  assert.match(source, /from agent.secret_scope import get_secret/);
  assert.match(source, /from hermes_cli.plugin_provider_requests import/);
  assert.match(source, /input=json.dumps\(request\)/);
  assert.match(source, /if refresh:/);
  const collector = await readFile(new URL('scripts/provider-history.ts', root), 'utf8');
  for (const forbidden of ['auth.json', 'credential_pool', 'codex-cli', 'x-openai-internal-codex-residency', 'claimsOf', 'readEnv']) assert.ok(!collector.includes(forbidden), forbidden);
});

test('Codex broker failures remain honest and never trigger a private fallback', async () => {
  for (const [codex, status, reason] of [
    [{error:'public-api-unavailable'}, 'unavailable', 'public-api-unavailable'],
    [{error:'no-credentials'}, 'auth-required', 'no-credentials'],
    [{status:401}, 'auth-required', 'auth-failed'],
    [{status:403}, 'auth-required', 'permission-denied'],
    [{status:429}, 'unavailable', 'rate-limited'],
    [{status:200,data:null}, 'unavailable', 'invalid-provider-response'],
  ] as const) {
    let calls = 0;
    const out = await collectActivityProviderHistory({home:await home(),days:365,provider:'openai-codex',refresh:true,codex,fetch:async()=>{calls++;throw new Error('unexpected');}});
    const row = out.overview[0];
    assert.equal(row.status,status);
    assert.equal(row.reason,reason);
    assert.deepEqual(row.daily,[]);
    assert.equal(calls,0);
  }
});

const root = new URL('../', import.meta.url);
async function home() {
  const base = join(homedir(), '.hermes/cache/scratch');
  await mkdir(base, { recursive: true });
  return mkdtemp(join(base, 'activity-credentials-'));
}

test('refresh ignores private credential files and inherited API keys', async () => {
  const dir = await home();
  await writeFile(join(dir, '.env'), 'OLLAMA_API_KEY=private-file-value\n');
  await writeFile(join(dir, 'auth.json'), 'invalid private auth contents');
  let calls = 0;
  const out = await collectActivityProviderHistory({ home: dir, days: 365, provider: 'all', refresh: true, fetch: async () => { calls++; throw new Error('unexpected'); } });
  assert.equal(calls, 0);
  assert.equal(out.overview.find((r: any) => r.id === 'ollama').reason, 'no-credentials');
  assert.equal(out.overview.find((r: any) => r.id === 'openai-codex').reason, 'public-api-unavailable');
  const path = join(dir, 'plugin-data/hermes-activity/activity_provider_history.json');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(join(dir, 'plugin-data/hermes-activity'))).mode & 0o777, 0o700);
  assert.ok(!(await readFile(path, 'utf8')).includes('private-file-value'));
});
