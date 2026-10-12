import { execFileSync } from "node:child_process";
import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "desktop");
const entryPath = join(outDir, "plugin.js");
const helperFile = "provider-history.js";
const helperPath = join(outDir, helperFile);

const entry = await readFile(entryPath, "utf8");
const helper = await readFile(helperPath, "utf8");

const importPattern = new RegExp(`import\\s*\\{[^}]*\\}\\s*from\\s*["']\\./${helperFile.replace(/\./g, "\\.")}["'];?`, "g");
const imports = entry.match(importPattern) ?? [];
if (imports.length !== 1) {
  throw new Error(`Expected exactly one ${helperFile} import in the compiled desktop entry, found ${imports.length}`);
}
if (/^\s*import\s/m.test(helper)) {
  throw new Error(`${helperFile} must stay self-contained (no import statements) to inline into the single desktop entry`);
}

const helperBody = helper
  .replace(/^export\s+(?=function|const|let|var|class|enum)/gm, "")
  .replace(/^export\s*\{[^}]*\};?\s*$/gm, "");
if (/^export\s/m.test(helperBody)) {
  throw new Error(`Failed to strip export statements from ${helperFile}`);
}
const bundled = entry.replace(importPattern, `${helperBody.trimEnd()}\n`);

if (bundled.includes(`from "./${helperFile}"`)) {
  throw new Error(`Bundled desktop entry still references ${helperFile}`);
}
if (!/^export default\s/m.test(bundled)) {
  throw new Error("Bundled desktop entry lost its default export");
}
await writeFile(entryPath, bundled);
await unlink(helperPath);
execFileSync(process.execPath, ["--check", entryPath]);

const remaining = (await readdir(outDir)).filter((name) => name !== "plugin.js" && !name.startsWith("."));
if (remaining.length) {
  throw new Error(`Desktop output must stay a single file, found: ${remaining.join(", ")}`);
}
