import { describe, expect, it } from "vitest";
import type { AdapterContext, Project, McpServer } from "@katahq/core";
import { cursorAdapter } from "@katahq/adapter-cursor";

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
    config: { version: 1, targets: { cursor: { enabled: true, options: {} } } },
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

const base: Omit<McpServer, "transport"> = {
  args: [],
  env: {},
  headers: {},
  scope: "project",
};

describe("cursor adapter emit", () => {
  it("emits an always-apply rule file it fully owns (golden)", async () => {
    const context = makeContext({ instructions: [{ name: "a", content: "Use strict TS.\n" }] });
    const { files } = await cursorAdapter.emit(context);
    const rule = files.find((f) => f.relativePath === ".cursor/rules/kata.mdc");
    expect(rule?.strategy.kind).toBe("replace");
    expect(rule?.content).toBe(
      [
        "---",
        "description: Project instructions managed by kata",
        "alwaysApply: true",
        "---",
        "",
        "Use strict TS.",
        "",
      ].join("\n"),
    );
  });

  it("passes ${env:VAR} through unchanged in mcp.json (golden)", async () => {
    const server: McpServer = {
      ...base,
      transport: "stdio",
      command: "npx",
      args: ["-y", "server-github"],
      env: { GITHUB_TOKEN: "${env:GITHUB_TOKEN}" },
    };
    const { files, warnings } = await cursorAdapter.emit(
      makeContext({ mcpServers: { github: server } }),
    );
    expect(warnings).toEqual([]);
    const mcp = files.find((f) => f.relativePath === ".cursor/mcp.json");
    expect(mcp?.strategy.kind).toBe("json-merge");
    expect(JSON.parse(mcp!.content)).toEqual({
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "server-github"],
          env: { GITHUB_TOKEN: "${env:GITHUB_TOKEN}" },
        },
      },
    });
  });

  it("emits commands with frontmatter stripped, skills verbatim, and warns on agents", async () => {
    const { files, warnings } = await cursorAdapter.emit(
      makeContext({
        prompts: [{ name: "review", content: "---\ndescription: Review\n---\nReview it.\n" }],
        agents: [{ name: "a", content: "y" }],
        skills: [{ name: "deploy", files: [{ relativePath: "SKILL.md", content: "Deploy.\n" }] }],
      }),
    );
    const command = files.find((f) => f.relativePath === ".cursor/commands/review.md");
    expect(command?.content).toBe("Review it.\n");
    expect(files.some((f) => f.relativePath === ".cursor/skills/deploy/SKILL.md")).toBe(true);
    expect(warnings[0]?.artifact).toBe("subagents");
  });

  it("warns about env refs in remote server headers", async () => {
    const server: McpServer = {
      ...base,
      transport: "http",
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer ${env:TOKEN}" },
    };
    const { warnings } = await cursorAdapter.emit(makeContext({ mcpServers: { remote: server } }));
    expect(warnings[0]?.message).toMatch(/does not interpolate/);
  });

  it("routes global-scope servers to ~/.cursor/mcp.json", async () => {
    const projectServer: McpServer = { ...base, transport: "stdio", command: "a" };
    const globalServer: McpServer = { ...base, transport: "stdio", command: "b", scope: "global" };
    const { files } = await cursorAdapter.emit(
      makeContext({ mcpServers: { local: projectServer, personal: globalServer } }),
    );
    const jsons = files.filter((f) => f.relativePath === ".cursor/mcp.json");
    expect(jsons).toHaveLength(2);
    const global = jsons.find((f) => f.scope === "global");
    expect(Object.keys(JSON.parse(global!.content).mcpServers)).toEqual(["personal"]);
  });

  it("emits ~/.cursor files in a global run, warning on instructions", async () => {
    const server: McpServer = { ...base, transport: "stdio", command: "npx" };
    const { files, warnings } = await cursorAdapter.emit(
      makeContext({
        scope: "global",
        instructions: [{ name: "base", content: "Global rules.\n" }],
        mcpServers: { github: server },
        prompts: [{ name: "review", content: "Review it.\n" }],
        skills: [{ name: "deploy", files: [{ relativePath: "SKILL.md", content: "Deploy.\n" }] }],
      }),
    );
    expect(warnings[0]?.artifact).toBe("instructions");
    expect(files.map((f) => [f.relativePath, f.scope])).toEqual([
      [".cursor/mcp.json", "global"],
      [".cursor/commands/review.md", "global"],
      [".cursor/skills/deploy/SKILL.md", "global"],
    ]);
  });
});
