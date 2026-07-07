import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AdapterContext } from "@katahq/core";
import { cursorAdapter } from "@katahq/adapter-cursor";

let tmp: string;

async function scaffold(files: Record<string, string>): Promise<AdapterContext> {
  tmp = await mkdtemp(path.join(os.tmpdir(), "kata-cursor-import-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(tmp, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
  return {
    project: {
      rootDir: tmp,
      configDir: path.join(tmp, ".kata"),
      config: { version: 1, targets: {} },
      packages: [],
      scope: "project",
      instructions: [],
      mcpServers: {},
      prompts: [],
      agents: [],
      skills: [],
    },
    projectRoot: tmp,
    homeDir: "/fake/home",
    scope: "project",
    targetOptions: {},
  };
}

afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("cursor adapter import", () => {
  it("imports rules as instructions, excluding kata's own rule file", async () => {
    const context = await scaffold({
      ".cursor/rules/style.mdc": "---\nalwaysApply: true\n---\nUse tabs.\n",
      ".cursor/rules/kata.mdc": "---\nalwaysApply: true\n---\ngenerated\n",
    });
    const result = await cursorAdapter.import!(context);
    expect(result.instructions.map((i) => i.name)).toEqual(["imported-cursor-style"]);
    expect(result.instructions[0]?.content).toBe("Use tabs.\n");
  });

  it("imports mcp.json servers with env refs unchanged, plus commands and skills", async () => {
    const context = await scaffold({
      ".cursor/mcp.json": JSON.stringify({
        mcpServers: {
          github: { command: "npx", env: { TOKEN: "${env:GITHUB_TOKEN}" } },
          remote: { url: "https://x/mcp" },
        },
      }),
      ".cursor/commands/ship.md": "Ship it.\n",
      ".cursor/skills/deploy/SKILL.md": "Deploy.\n",
    });
    const result = await cursorAdapter.import!(context);
    expect(result.mcpServers.github?.env.TOKEN).toBe("${env:GITHUB_TOKEN}");
    expect(result.mcpServers.remote?.transport).toBe("http");
    expect(result.prompts.map((p) => p.name)).toEqual(["ship"]);
    expect(result.skills.map((s) => s.name)).toEqual(["deploy"]);
  });
});
