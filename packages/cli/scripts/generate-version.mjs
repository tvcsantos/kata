// Writes src/version.ts from the package.json version (runs as prebuild).
import { readFile, writeFile } from "node:fs/promises";
import { URL } from "node:url";

const packageJsonUrl = new URL("../package.json", import.meta.url);
const versionFileUrl = new URL("../src/version.ts", import.meta.url);

const { version } = JSON.parse(await readFile(packageJsonUrl, "utf8"));
const content = `// Generated from package.json by scripts/generate-version.mjs - do not edit.
export const KATA_VERSION = "${version}";
`;

let current;
try {
  current = await readFile(versionFileUrl, "utf8");
} catch {
  current = null;
}
if (current !== content) {
  await writeFile(versionFileUrl, content, "utf8");
}
