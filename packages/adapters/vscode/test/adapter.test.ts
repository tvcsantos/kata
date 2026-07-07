import { describe, expect, it } from "vitest";
import type { AdapterContext, Project, McpServer } from "@katahq/core";
import { vscodeAdapter } from "@katahq/adapter-vscode";

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

describe("vscode adapter emit", () => {
  it("emits .vscode/mcp.json under servers with ${env:VAR} passthrough (golden)", async () => {
    const github: McpServer = {
      transport: "stdio",
      command: "npx",
      args: ["-y", "server-github"],
      env: { TOKEN: "${env:GITHUB_TOKEN}" },
      headers: {},
      scope: "project",
    };
    const remote: McpServer = {
      transport: "sse",
      args: [],
      env: {},
      url: "https://mcp.example.com/sse",
      headers: {},
      scope: "project",
    };
    const { files } = await vscodeAdapter.emit(makeContext({ mcpServers: { github, remote } }));
    const mcp = JSON.parse(files.find((f) => f.relativePath === ".vscode/mcp.json")!.content);
    expect(mcp.servers.github).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "server-github"],
      env: { TOKEN: "${env:GITHUB_TOKEN}" },
    });
    expect(mcp.servers.remote).toEqual({ type: "sse", url: "https://mcp.example.com/sse" });
  });

  it("emits prompt files with description frontmatter only", async () => {
    const { files } = await vscodeAdapter.emit(
      makeContext({
        prompts: [
          {
            name: "review",
            content: "---\ndescription: Review code\nallowed-tools: Bash\n---\nReview the diff.\n",
          },
        ],
      }),
    );
    const prompt = files.find((f) => f.relativePath === ".github/prompts/review.prompt.md");
    expect(prompt?.content).toBe('---\ndescription: "Review code"\n---\n\nReview the diff.\n');
  });

  it("shares instructions, agents, and skills locations with copilot", async () => {
    const { files } = await vscodeAdapter.emit(
      makeContext({
        instructions: [{ name: "base", content: "Be brief.\n" }],
        agents: [{ name: "tester", content: "Test.\n" }],
        skills: [{ name: "deploy", files: [{ relativePath: "SKILL.md", content: "Deploy.\n" }] }],
      }),
    );
    const paths = files.map((f) => f.relativePath);
    expect(paths).toContain(".github/copilot-instructions.md");
    expect(paths).toContain(".github/agents/tester.agent.md");
    expect(paths).toContain(".github/skills/deploy/SKILL.md");
  });

  it("emits profile-dir mcp.json, instructions, and prompts in a global run", async () => {
    const server: McpServer = {
      transport: "stdio",
      command: "npx",
      args: [],
      env: {},
      headers: {},
      scope: "project",
    };
    const { files, warnings } = await vscodeAdapter.emit(
      makeContext({
        scope: "global",
        instructions: [{ name: "base", content: "Global rules.\n" }],
        mcpServers: { github: server },
        prompts: [{ name: "review", content: "Review the diff.\n" }],
        agents: [{ name: "tester", content: "Test.\n" }],
      }),
    );
    expect(files.every((f) => f.scope === "global")).toBe(true);
    const paths = files.map((f) => f.relativePath);
    // The profile dir is platform-dependent; every path lives under it.
    expect(paths.some((p) => p.endsWith("Code/User/mcp.json"))).toBe(true);
    expect(paths.some((p) => p.endsWith("Code/User/prompts/kata.instructions.md"))).toBe(true);
    expect(paths.some((p) => p.endsWith("Code/User/prompts/review.prompt.md"))).toBe(true);
    expect(warnings[0]?.artifact).toBe("subagents");
  });
});
