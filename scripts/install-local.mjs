import { copyFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = process.env.HERMES_HOME || join(homedir(), ".hermes");
const id = "hermes-activity";
const destination = join(home, "desktop-plugins", id, "plugin.js");

await mkdir(dirname(destination), { recursive: true });
await copyFile(join(root, "desktop", "plugin.js"), destination);
console.log(`Installed desktop entry for ${id} into ${destination}`);
console.log("The Hermes Desktop plugin watcher should load it automatically.");
