import { defineConfig } from "tsup";

export default defineConfig({
  // index is the bin; command-registry and help are loaded by oclif at runtime
  // via the "oclif" section of package.json.
  entry: ["src/index.ts", "src/command-registry.ts", "src/help.ts"],
  format: ["esm"],
  target: "node24",
  platform: "node",
  // Bundle workspace packages so the published CLI is self-contained.
  noExternal: [/^@kata\//],
  banner: { js: "#!/usr/bin/env node" },
  clean: true,
});
