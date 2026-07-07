import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mergeManagedRegion, type AdapterContext } from "@katahq/core";
import { claudeCodeAdapter } from "@katahq/adapter-claude-code";

let tmp: string;

async function scaffold(files: Record<string, string>): Promise<AdapterContext> {
  tmp = await mkdtemp(path.join(os.tmpdir(), "kata-cc-import-"));
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

describe("claude-code adapter import", () => {
  it("imports user content from CLAUDE.md, excluding the managed region", async () => {
    const withRegion = mergeManagedRegion("# Hand-written notes\n", "generated body");
    const context = await scaffold({ "CLAUDE.md": withRegion });
    const result = await claudeCodeAdapter.import!(context);
    expect(result.instructions).toHaveLength(1);
    expect(result.instructions[0]?.content).toContain("Hand-written notes");
    expect(result.instructions[0]?.content).not.toContain("generated body");
  });

  it("imports nothing from a CLAUDE.md that is only a managed region", async () => {
    const context = await scaffold({ "CLAUDE.md": mergeManagedRegion(null, "generated") });
    const result = await claudeCodeAdapter.import!(context);
    expect(result.instructions).toEqual([]);
  });

  it("imports .mcp.json servers, converting ${VAR} to ${env:VAR}", async () => {
    const context = await scaffold({
      ".mcp.json": JSON.stringify({
        mcpServers: {
          github: {
            command: "npx",
            args: ["-y", "server-github"],
            env: { TOKEN: "${GITHUB_TOKEN}" },
          },
          remote: { type: "http", url: "https://x/mcp", headers: { Auth: "${T}" } },
          weird: { neither: true },
        },
      }),
    });
    const result = await claudeCodeAdapter.import!(context);
    expect(result.mcpServers.github?.env.TOKEN).toBe("${env:GITHUB_TOKEN}");
    expect(result.mcpServers.remote?.transport).toBe("http");
    expect(result.mcpServers.remote?.headers.Auth).toBe("${env:T}");
    expect(result.mcpServers.weird).toBeUndefined();
    expect(result.warnings[0]?.message).toMatch(/unrecognized shape/);
  });

  it("imports commands, agents, and skills from .claude/", async () => {
    const context = await scaffold({
      ".claude/commands/review.md": "Review the diff.\n",
      ".claude/agents/tester.md": "---\ndescription: t\n---\nTest.\n",
      ".claude/skills/deploy/SKILL.md": "---\nname: deploy\n---\nGo.\n",
      ".claude/skills/deploy/scripts/run.sh": "#!/bin/sh\n",
      ".claude/skills/no-skill-md/notes.txt": "not a skill\n",
    });
    const result = await claudeCodeAdapter.import!(context);
    expect(result.prompts.map((p) => p.name)).toEqual(["review"]);
    expect(result.agents.map((a) => a.name)).toEqual(["tester"]);
    expect(result.skills.map((s) => s.name)).toEqual(["deploy"]);
    expect(result.skills[0]?.files.map((f) => f.relativePath)).toEqual([
      "SKILL.md",
      "scripts/run.sh",
    ]);
  });
});
