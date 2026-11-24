import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// The model panel used to group the `sessions` table on its single `model`
// field, so a session that called several models put all of its cost on the one
// model recorded in its row and never showed the others; names recorded under a
// route alias (`deepseek-flash`, `strata/Qwen-flash-next`) were separate rows,
// and a provider recorded under a retired id stayed a row of its own. This runs
// the real backend against a hermetic HOME whose state.db carries one session
// that used three models through two recorded provider aliases, so the
// assertions describe the panel's contract to the reader, not an internal query.
const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = join(process.env.HERMES_HOME || join(homedir(), ".hermes"), "cache", "scratch");

const seed = `
import json, sqlite3, sys, time
from pathlib import Path

state = Path(sys.argv[1])
conn = sqlite3.connect(state)
conn.executescript("""
CREATE TABLE sessions (
    id TEXT PRIMARY KEY, title TEXT, source TEXT, model TEXT,
    billing_provider TEXT, billing_base_url TEXT, billing_mode TEXT,
    input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
    cache_write_tokens INTEGER, reasoning_tokens INTEGER,
    message_count INTEGER, tool_call_count INTEGER, api_call_count INTEGER,
    estimated_cost_usd REAL, actual_cost_usd REAL,
    parent_session_id TEXT, started_at REAL
);
CREATE TABLE session_model_usage (
    session_id TEXT NOT NULL, model TEXT NOT NULL,
    billing_provider TEXT NOT NULL DEFAULT '', billing_base_url TEXT NOT NULL DEFAULT '',
    billing_mode TEXT NOT NULL DEFAULT '', task TEXT NOT NULL DEFAULT '',
    api_call_count INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd REAL NOT NULL DEFAULT 0, actual_cost_usd REAL NOT NULL DEFAULT 0,
    cost_status TEXT, cost_source TEXT, first_seen REAL, last_seen REAL
);
""")
now = time.time() - 3600
# One session whose recorded model is Qwen-flash-next but which spent most of
# its money on deepseek/deepseek-flash, plus a tiny undeclared engine id.
conn.execute("INSERT INTO sessions VALUES ('s1','fixture','cli','Qwen-flash-next','custom','https://gw.example.test/v1',"
             "'',100,50,0,0,0,4,4,3,0,3.001,'',?)", (now,))
rows = [
    # (model, provider recorded at call time, calls, est cost, actual cost)
    ("strata/Qwen-flash-next", "custom", 1, 1.0, 0.0),
    ("deepseek-flash", "litellm", 1, 0.0, 2.0),
    ("swift-1.5-iq2_xs", "custom", 0, 0.001, 0.0),   # cost but no calls: kept
    ("ghost-model", "custom", 0, 0.0, 0.0),           # neither: dropped
]
for model, provider, calls, est, actual in rows:
    conn.execute("INSERT INTO session_model_usage (session_id,model,billing_provider,billing_base_url,"
                 "api_call_count,estimated_cost_usd,actual_cost_usd,last_seen) VALUES (?,?,?,?,?,?,?,?)",
                 ("s1", model, provider, "https://gw.example.test/v1", calls, est, actual, now))
conn.commit()
conn.close()
print("seeded")
`;

const stubs = {
  "hermes_constants.py": `
import os
def get_hermes_home():
    return os.environ["HERMES_HOME"]
`,
  "hermes_cli/__init__.py": "",
  "hermes_cli/config.py": `
import json, os
from pathlib import Path
def load_config_readonly():
    path = Path(os.environ["HERMES_HOME"]) / "config.json"
    return json.loads(path.read_text()) if path.exists() else {}
def cfg_get(cfg, key, default=None):
    return (cfg or {}).get(key, default)
`,
};

test("model rows attribute cost per model, by the model and provider the endpoint declares", async () => {
  await mkdir(scratch, { recursive: true });
  const home = await mkdtemp(join(scratch, "activity-models-"));
  try {
    await symlink(pluginRoot, join(home, "activity_pkg"), "dir");
    const stub = join(home, "stub");
    await mkdir(join(stub, "hermes_cli"), { recursive: true });
    for (const [name, body] of Object.entries(stubs)) {
      await writeFile(join(stub, name), body.trimStart());
    }
    // The profile config names the endpoint that served the calls and the model
    // names it declares; `custom` and `litellm` are aliases recorded at call time.
    await writeFile(
      join(home, "config.json"),
      JSON.stringify({
        providers: {
          gw: {
            base_url: "https://gw.example.test/v1",
            model: "Qwen-flash-next",
            models: { "Qwen-flash-next": {}, "deepseek/deepseek-flash": {} },
          },
        },
      }),
    );
    execFileSync("python3", ["-c", seed, join(home, "state.db")], { encoding: "utf8", timeout: 60_000 });
    const script = [
      "import json",
      `import sys; sys.path.insert(0, ${JSON.stringify(home)})`,
      "import activity_pkg.activity_data as ad",
      "print(json.dumps(ad.summary(days=7)))",
    ].join("\n");
    const payload = JSON.parse(
      execFileSync("python3", ["-c", script], {
        env: { ...process.env, HERMES_HOME: home, PYTHONPATH: stub },
        encoding: "utf8",
        timeout: 120_000,
      }),
    );
    const rows = payload.models as Array<Record<string, any>>;
    const byModel = new Map(rows.map((row) => [row.model, row]));

    // Cost lands on the model that answered, not on the session's recorded one.
    assert.equal(byModel.get("Qwen-flash-next")?.cost_usd, 1);
    assert.equal(byModel.get("deepseek/deepseek-flash")?.cost_usd, 2);
    // Provider-qualified and prefix-stripped names resolve to the declared name.
    assert.equal(byModel.has("strata/Qwen-flash-next"), false);
    assert.equal(byModel.has("deepseek-flash"), false);
    // An engine id the endpoint never declares is not a name variant of the
    // alias, so it stays its own row instead of being renamed to a guess.
    assert.equal(byModel.get("swift-1.5-iq2_xs")?.cost_usd, 0.001);
    // No traffic and no cost is not a row; a row with cost but no call is.
    assert.equal(byModel.has("ghost-model"), false);
    // Both recorded provider aliases resolve to the provider that serves the
    // endpoint today, so the panel shows one provider row per real route.
    for (const row of rows) {
      assert.equal(row.provider, "gw", `unexpected provider row: ${JSON.stringify(row)}`);
    }
    // The model view sums to the page total, so nothing is left unattributed.
    const modelCost = rows.reduce((sum, row) => sum + row.cost_usd, 0);
    assert.equal(Math.round(modelCost * 1e6) / 1e6, Math.round(payload.totals.cost_usd * 1e6) / 1e6);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
