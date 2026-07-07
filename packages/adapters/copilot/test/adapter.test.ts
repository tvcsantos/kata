import { describe, expect, it } from "vitest";
import type { AdapterContext, Project, McpServer } from "@katahq/core";
import { copilotAdapter } from "@katahq/adapter-copilot";

function makeContext(
  overrides: Partial<
    Pick<Project, "instructions" | "mcpServers" | "prompts" | "agents" | "skills" | "scope">
  >,
): AdapterContext {
  const project: Project = {
    rootDir: "/fake/project",
    configDir: "/fake/project/.kata",
    config: { version: 1, targets: {} },
    packages: [],
    scope: "project",
    instructions: [],
    mcpServers: {},
    prompts: [],
    agents: [],
    skills: [],
    ...overrides,
  };
  return {
    project,
    projectRoot: project.rootDir,
    homeDir: "/fake/home",
    scope: project.scope,
    targetOptions: {},
  };
}

describe("copilot adapter emit", () => {
  it("emits instructions, .mcp.json with tools allowlist, agents, skills (golden)", async () => {
    const github: McpServer = {
      transport: "stdio",
      command: "npx",
      args: ["-y", "server-github"],
      env: { TOKEN: "${env:GITHUB_TOKEN}" },
      headers: {},
      scope: "project",
    };
    const { files, warnings } = await copilotAdapter.emit(
      makeContext({
        instructions: [{ name: "base", content: "Be brief.\n" }],
        mcpServers: { github },
        agents: [{ name: "tester", content: "---\ndescription: t\n---\nTest.\n" }],
        skills: [{ name: "deploy", files: [{ relativePath: "SKILL.md", content: "Deploy.\n" }] }],
      }),
    );
    expect(warnings).toEqual([]);
    expect(
      files.find((f) => f.relativePath === ".github/copilot-instructions.md")?.strategy.kind,
    ).toBe("managed-region");
    const mcp = JSON.parse(files.find((f) => f.relativePath === ".mcp.json")!.content);
    expect(mcp.mcpServers.github).toEqual({
      command: "npx",
      args: ["-y", "server-github"],
      env: { TOKEN: "${GITHUB_TOKEN}" },
      tools: ["*"],
    });
    expect(files.some((f) => f.relativePath === ".github/agents/tester.agent.md")).toBe(true);
    expect(files.some((f) => f.relativePath === ".github/skills/deploy/SKILL.md")).toBe(true);
  });

  it("warns on prompts (no project-level prompt files)", async () => {
    const { warnings } = await copilotAdapter.emit(
      makeContext({ prompts: [{ name: "p", content: "x" }] }),
    );
    expect(warnings[0]?.artifact).toBe("prompts");
  });

  it("routes global-scope servers to ~/.copilot/mcp-config.json", async () => {
    const local: McpServer = {
      transport: "stdio",
      command: "a",
      args: [],
      env: {},
      headers: {},
      scope: "project",
    };
    const personal: McpServer = { ...local, command: "b", scope: "global" };
    const { files } = await copilotAdapter.emit(makeContext({ mcpServers: { local, personal } }));
    expect(
      Object.keys(
        JSON.parse(files.find((f) => f.relativePath === ".mcp.json")!.content).mcpServers,
      ),
    ).toEqual(["local"]);
    const global = files.find((f) => f.relativePath === ".copilot/mcp-config.json");
    expect(global?.scope).toBe("global");
    expect(Object.keys(JSON.parse(global!.content).mcpServers)).toEqual(["personal"]);
  });

  it("emits user-level MCP and agents in a global run, warning on the rest", async () => {
    const server: McpServer = {
      transport: "stdio",
      command: "npx",
      args: [],
      env: {},
      headers: {},
      scope: "project",
    };
    const { files, warnings } = await copilotAdapter.emit(
      makeContext({
        scope: "global",
        instructions: [{ name: "base", content: "Global rules.\n" }],
        mcpServers: { github: server },
        agents: [{ name: "tester", content: "Test.\n" }],
        skills: [{ name: "deploy", files: [{ relativePath: "SKILL.md", content: "Deploy.\n" }] }],
      }),
    );
    expect(files.map((f) => [f.relativePath, f.scope])).toEqual([
      [".copilot/mcp-config.json", "global"],
      [".copilot/agents/tester.agent.md", "global"],
    ]);
    expect(warnings.map((w) => w.artifact).sort()).toEqual(["instructions", "skills"]);
  });
});
