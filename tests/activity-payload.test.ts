import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const repo = process.cwd();
const hermes = process.env.HERMES_BIN || "hermes";

test("desktop year summary stays parseable below cli.exec's output cap", () => {
  const home = mkdtempSync(join(tmpdir(), "hermes-activity-test-"));
  try {
    mkdirSync(join(home, "plugins"), { recursive: true });
    symlinkSync(repo, join(home, "plugins", "hermes-activity"), "dir");
    symlinkSync(join(process.env.HOME, ".hermes", "state.db"), join(home, "state.db"));
    writeFileSync(join(home, "config.yaml"), "plugins:\n  enabled:\n    - hermes-activity\n");
    const env = { ...process.env, HERMES_HOME: home };
    const output = execFileSync(
      hermes,
      ["--profile", "default", "activity", "summary", "--days", "365", "--desktop", "--json"],
      { env, encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
    assert.ok(Buffer.byteLength(output) < 48_000);
    const payload = JSON.parse(output);
    assert.equal(payload.plugin_version, "0.1.1");
    assert.equal(payload.daily.length > 0, true);
    assert.ok(payload.models.length <= 8);
    assert.ok(payload.tools.length <= 8);
    assert.ok(payload.skills.top_skills.length <= 8);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
