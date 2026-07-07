import { describe, expect, it } from "vitest";
import type { AdapterContext, Project, McpServer } from "@katahq/core";
import { opencodeAdapter } from "@katahq/adapter-opencode";

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

describe("opencode adapter emit", () => {
  it("emits opencode.json with command array and {env:VAR} refs (golden)", async () => {
    const github: McpServer = {
      transport: "stdio",
      command: "npx",
      args: ["-y", "server-github"],
      env: { TOKEN: "${env:GITHUB_TOKEN}" },
      headers: {},
      scope: "project",
    };
    const remote: McpServer = {
      transport: "http",
      args: [],
      env: {},
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer ${env:T}" },
      scope: "project",
    };
    const { files } = await opencodeAdapter.emit(makeContext({ mcpServers: { github, remote } }));
    const config = JSON.parse(files.find((f) => f.relativePath === "opencode.json")!.content);
    expect(config.mcp.github).toEqual({
      type: "local",
      command: ["npx", "-y", "server-github"],
      enabled: true,
      environment: { TOKEN: "{env:GITHUB_TOKEN}" },
    });
    expect(config.mcp.remote).toEqual({
      type: "remote",
      url: "https://mcp.example.com/mcp",
      enabled: true,
      headers: { Authorization: "Bearer {env:T}" },
    });
  });

  it("emits AGENTS.md, commands verbatim, and skills", async () => {
    const { files } = await opencodeAdapter.emit(
      makeContext({
        instructions: [{ name: "base", content: "Be brief.\n" }],
        prompts: [{ name: "ship", content: "---\ndescription: Ship\n---\nShip it.\n" }],
        skills: [{ name: "deploy", files: [{ relativePath: "SKILL.md", content: "Deploy.\n" }] }],
      }),
    );
    expect(files.find((f) => f.relativePath === "AGENTS.md")?.strategy.kind).toBe("managed-region");
    expect(files.find((f) => f.relativePath === ".opencode/commands/ship.md")?.content).toContain(
      "description: Ship",
    );
    expect(files.some((f) => f.relativePath === ".opencode/skills/deploy/SKILL.md")).toBe(true);
  });

  it("rewrites subagent frontmatter with mode: subagent and drops tools", async () => {
    const { files, warnings } = await opencodeAdapter.emit(
      makeContext({
        agents: [
          {
            name: "tester",
            content:
              "---\ndescription: Runs tests\ntools: Read, Bash\nmodel: sonnet\n---\nRun the tests.\n",
          },
        ],
      }),
    );
    const agent = files.find((f) => f.relativePath === ".opencode/agents/tester.md");
    expect(agent?.content).toContain("mode: subagent");
    expect(agent?.content).toContain("description: Runs tests");
    expect(agent?.content).toContain("model: sonnet");
    expect(agent?.content).not.toContain("tools:");
    expect(agent?.content).toContain("Run the tests.");
    expect(warnings[0]?.message).toMatch(/tools restriction was dropped/);
  });

  it("emits user-level files under ~/.config/opencode in a global run", async () => {
    const server: McpServer = {
      transport: "stdio",
      command: "npx",
      args: [],
      env: {},
      headers: {},
      scope: "project",
    };
    const { files } = await opencodeAdapter.emit(
      makeContext({
        scope: "global",
        instructions: [{ name: "base", content: "Global rules.\n" }],
        mcpServers: { github: server },
        prompts: [{ name: "ship", content: "Ship it.\n" }],
        skills: [{ name: "deploy", files: [{ relativePath: "SKILL.md", content: "Deploy.\n" }] }],
      }),
    );
    expect(files.map((f) => [f.relativePath, f.scope])).toEqual([
      [".config/opencode/AGENTS.md", "global"],
      [".config/opencode/opencode.json", "global"],
      [".config/opencode/commands/ship.md", "global"],
      [".config/opencode/skills/deploy/SKILL.md", "global"],
    ]);
  });
});
