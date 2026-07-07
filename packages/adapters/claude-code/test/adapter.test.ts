import { describe, expect, it } from "vitest";
import type { AdapterContext, Project, McpServer } from "@katahq/core";
import { claudeCodeAdapter } from "@katahq/adapter-claude-code";

function makeContext(overrides: {
  instructions?: { name: string; content: string }[];
  mcpServers?: Record<string, McpServer>;
  prompts?: { name: string; content: string }[];
  agents?: { name: string; content: string }[];
  skills?: { name: string; files: { relativePath: string; content: string }[] }[];
  scope?: "project" | "global";
}): AdapterContext {
  const scope = overrides.scope ?? "project";
  const project: Project = {
    rootDir: "/fake/project",
    configDir: "/fake/project/.kata",
    config: { version: 1, targets: { "claude-code": { enabled: true, options: {} } } },
    packages: [],
    scope,
    instructions: overrides.instructions ?? [],
    mcpServers: overrides.mcpServers ?? {},
    prompts: overrides.prompts ?? [],
    agents: overrides.agents ?? [],
    skills: overrides.skills ?? [],
  };
  return {
    project,
    projectRoot: project.rootDir,
    homeDir: "/fake/home",
    scope,
    targetOptions: {},
  };
}

const stdioServer: McpServer = {
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${env:GITHUB_TOKEN}" },
  headers: {},
  scope: "project",
};

const httpServer: McpServer = {
  transport: "http",
  args: [],
  env: {},
  url: "https://mcp.example.com/mcp",
  headers: { Authorization: "Bearer ${env:EXAMPLE_TOKEN}" },
  scope: "project",
};

describe("claude-code adapter emit", () => {
  it("emits CLAUDE.md as a managed region from composed instructions", async () => {
    const context = makeContext({
      instructions: [
        { name: "a", content: "First part.\n" },
        { name: "b", content: "Second part.\n" },
      ],
    });
    const { files, warnings } = await claudeCodeAdapter.emit(context);
    expect(warnings).toEqual([]);
    const claudeMd = files.find((f) => f.relativePath === "CLAUDE.md");
    expect(claudeMd?.strategy.kind).toBe("managed-region");
    expect(claudeMd?.content).toBe("First part.\n\nSecond part.");
  });

  it("emits .mcp.json fragment with ${VAR} env expansion (golden)", async () => {
    const context = makeContext({ mcpServers: { github: stdioServer, remote: httpServer } });
    const { files } = await claudeCodeAdapter.emit(context);
    const mcp = files.find((f) => f.relativePath === ".mcp.json");
    expect(mcp?.strategy.kind).toBe("json-merge");
    expect(JSON.parse(mcp!.content)).toEqual({
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
        },
        remote: {
          type: "http",
          url: "https://mcp.example.com/mcp",
          headers: { Authorization: "Bearer ${EXAMPLE_TOKEN}" },
        },
      },
    });
  });

  it("emits nothing when the project has no artifacts", async () => {
    const { files } = await claudeCodeAdapter.emit(makeContext({}));
    expect(files).toEqual([]);
  });

  it("emits global-scope servers to ~/.claude.json instead of .mcp.json", async () => {
    const globalServer: McpServer = { ...stdioServer, scope: "global" };
    const { files, warnings } = await claudeCodeAdapter.emit(
      makeContext({ mcpServers: { gh: globalServer, github: stdioServer } }),
    );
    expect(warnings).toEqual([]);
    const project = files.find((f) => f.relativePath === ".mcp.json");
    expect(project?.scope ?? "project").toBe("project");
    expect(Object.keys(JSON.parse(project!.content).mcpServers)).toEqual(["github"]);
    const global = files.find((f) => f.relativePath === ".claude.json");
    expect(global?.scope).toBe("global");
    expect(global?.strategy.kind).toBe("json-merge");
    expect(Object.keys(JSON.parse(global!.content).mcpServers)).toEqual(["gh"]);
  });

  it("emits everything to user-level locations in a global run", async () => {
    const context = makeContext({
      scope: "global",
      instructions: [{ name: "base", content: "Global rules.\n" }],
      mcpServers: { github: stdioServer },
      prompts: [{ name: "review", content: "Review it.\n" }],
      agents: [{ name: "tester", content: "Run tests.\n" }],
      skills: [{ name: "deploy", files: [{ relativePath: "SKILL.md", content: "Deploy.\n" }] }],
    });
    const { files, warnings } = await claudeCodeAdapter.emit(context);
    expect(warnings).toEqual([]);
    expect(files.map((f) => [f.relativePath, f.scope])).toEqual([
      [".claude/CLAUDE.md", "global"],
      [".claude.json", "global"],
      [".claude/commands/review.md", "global"],
      [".claude/agents/tester.md", "global"],
      [".claude/skills/deploy/SKILL.md", "global"],
    ]);
    expect(files.find((f) => f.relativePath === ".mcp.json")).toBeUndefined();
  });

  it("emits prompts, agents, and skills to .claude/ (golden)", async () => {
    const context = makeContext({
      prompts: [{ name: "review", content: "---\ndescription: Review\n---\nReview it.\n" }],
      agents: [{ name: "tester", content: "---\ndescription: Tests\n---\nRun tests.\n" }],
      skills: [
        {
          name: "deploy",
          files: [
            { relativePath: "SKILL.md", content: "---\nname: deploy\n---\nDeploy.\n" },
            { relativePath: "scripts/run.sh", content: "#!/bin/sh\n" },
          ],
        },
      ],
    });
    const { files, warnings } = await claudeCodeAdapter.emit(context);
    expect(warnings).toEqual([]);
    const paths = files.map((f) => f.relativePath);
    expect(paths).toEqual([
      ".claude/commands/review.md",
      ".claude/agents/tester.md",
      ".claude/skills/deploy/SKILL.md",
      ".claude/skills/deploy/scripts/run.sh",
    ]);
    // Prompt frontmatter passes through verbatim.
    expect(files[0]?.content).toContain("description: Review");
    expect(files.every((f) => f.strategy.kind === "replace")).toBe(true);
  });
});
