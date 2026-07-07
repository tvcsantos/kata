import path from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  test: {
    include: ["packages/**/test/**/*.test.ts", "packages/**/src/**/*.test.ts"],
  },
  resolve: {
    // Resolve workspace packages to their TS sources so tests don't require a build.
    alias: {
      "@katahq/core": path.resolve(root, "packages/core/src/index.ts"),
      "@katahq/adapter-claude-code": path.resolve(
        root,
        "packages/adapters/claude-code/src/index.ts",
      ),
      "@katahq/adapter-codex": path.resolve(root, "packages/adapters/codex/src/index.ts"),
      "@katahq/adapter-copilot": path.resolve(root, "packages/adapters/copilot/src/index.ts"),
      "@katahq/adapter-cursor": path.resolve(root, "packages/adapters/cursor/src/index.ts"),
      "@katahq/adapter-gemini": path.resolve(root, "packages/adapters/gemini/src/index.ts"),
      "@katahq/adapter-opencode": path.resolve(root, "packages/adapters/opencode/src/index.ts"),
      "@katahq/adapter-vscode": path.resolve(root, "packages/adapters/vscode/src/index.ts"),
    },
  },
});
