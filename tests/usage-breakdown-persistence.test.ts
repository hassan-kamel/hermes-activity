import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, symlink, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// The Tools/Skills panels come from core's InsightsEngine, which reads its
// storage through a persistence handle. Handing it a `SessionDB` worked until
// Hermes 0.23.3 retired `SessionDB.db_path` from the store's public surface;
// afterwards the engine raised AttributeError on the first read, the
// best-effort wrapper swallowed it, and both panels rendered empty. This runs
// the real backend against a hermetic HERMES_HOME whose state.db carries one
// tool call and one skill_view, so an empty result means the wiring broke
// again, not that the fixture lacked data.
const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = join(process.env.HERMES_HOME || join(homedir(), ".hermes"), "cache", "scratch");

const seed = `
import json, sqlite3, sys, time
from pathlib import Path

state = Path(sys.argv[1])
conn = sqlite3.connect(state)
conn.executescript("""
CREATE TABLE sessions (
    id TEXT PRIMARY KEY, started_at REAL, source TEXT, model TEXT,
    billing_provider TEXT, billing_base_url TEXT,
    input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
    cache_write_tokens INTEGER, reasoning_tokens INTEGER,
    message_count INTEGER, tool_call_count INTEGER
);
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT,
    tool_name TEXT, tool_calls TEXT, timestamp REAL, visibility TEXT
);
""")
now = time.time()
conn.execute("INSERT INTO sessions VALUES ('s1',?,?,?,?,?,0,0,0,0,0,2,2)",
             (now - 3600, "cli", "fixture-model", "fixture-provider", "https://fixture.invalid/v1"))
conn.execute("INSERT INTO messages (session_id,role,content,tool_name,timestamp,visibility)"
             " VALUES ('s1','tool','ok','terminal',?, 'visible')", (now - 3500,))
calls = json.dumps([
    {"type": "function", "function": {"name": "skill_view", "arguments": json.dumps({"name": "fixture-skill"})}}
])
conn.execute("INSERT INTO messages (session_id,role,content,tool_calls,timestamp,visibility)"
             " VALUES ('s1','assistant','',?,?, 'visible')", (calls, now - 3400))
conn.commit()
conn.close()
print("seeded")
`;

test("Tools/Skills breakdown reads through the persistence handle, not SessionDB attributes", async () => {
  await mkdir(scratch, { recursive: true });
  const home = await mkdtemp(join(scratch, "activity-breakdown-"));
  try {
    await symlink(pluginRoot, join(home, "activity_pkg"), "dir");
    const state = join(home, "state.db");
    execFileSync("python3", ["-c", seed, state], { encoding: "utf8", timeout: 60_000 });
    const script = [
      "import json,sys,time",
      `sys.path.insert(0,${JSON.stringify(home)})`,
      "import activity_pkg.activity_data as ad",
      "tools,skills=ad._usage_breakdown(time.time()-30*86400)",
      "print(json.dumps({'tools':tools,'skills':skills}))",
    ].join("\n");
    const out = JSON.parse(
      execFileSync("python3", ["-c", script], {
        env: { ...process.env, HERMES_HOME: home },
        encoding: "utf8",
        timeout: 120_000,
      }),
    );
    assert.ok(
      out.tools.some((row: any) => row.tool === "terminal" && row.count >= 1),
      `tool breakdown lost its rows: ${JSON.stringify(out.tools)}`,
    );
    const top = out.skills.top_skills || [];
    assert.ok(
      top.some((row: any) => row.skill === "fixture-skill"),
      `skill breakdown lost its rows: ${JSON.stringify(out.skills)}`,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
