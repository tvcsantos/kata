import { describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import type { AdapterContext, Project, McpServer } from "@katahq/core";
import { geminiAdapter } from "@katahq/adapter-gemini";

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

describe("gemini adapter emit", () => {
  it("emits GEMINI.md and settings.json with ${VAR} env refs (golden)", async () => {
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
    const sse: McpServer = {
      ...remote,
      transport: "sse",
      url: "https://mcp.example.com/sse",
      headers: {},
    };
    const { files, warnings } = await geminiAdapter.emit(
      makeContext({
        instructions: [{ name: "base", content: "Be brief.\n" }],
        mcpServers: { github, remote, sse },
      }),
    );
    expect(warnings).toEqual([]);
    expect(files.find((f) => f.relativePath === "GEMINI.md")?.strategy.kind).toBe("managed-region");
    const settings = JSON.parse(
      files.find((f) => f.relativePath === ".gemini/settings.json")!.content,
    );
    expect(settings.mcpServers.github.env.TOKEN).toBe("${GITHUB_TOKEN}");
    expect(settings.mcpServers.remote.httpUrl).toBe("https://mcp.example.com/mcp");
    expect(settings.mcpServers.remote.headers.Authorization).toBe("Bearer ${T}");
    expect(settings.mcpServers.sse.url).toBe("https://mcp.example.com/sse");
    expect(settings.mcpServers.sse.httpUrl).toBeUndefined();
  });

  it("emits prompts as TOML commands, converting $ARGUMENTS to {{args}}", async () => {
    const { files } = await geminiAdapter.emit(
      makeContext({
        prompts: [
          { name: "fix", content: "---\ndescription: Fix a bug\n---\nFix this bug: $ARGUMENTS\n" },
        ],
      }),
    );
    const cmd = files.find((f) => f.relativePath === ".gemini/commands/fix.toml");
    const parsed = parseToml(cmd!.content) as { description: string; prompt: string };
    expect(parsed.description).toBe("Fix a bug");
    expect(parsed.prompt).toBe("Fix this bug: {{args}}\n");
  });

  it("warns on skills and agents", async () => {
    const { files, warnings } = await geminiAdapter.emit(
      makeContext({
        agents: [{ name: "a", content: "x" }],
        skills: [{ name: "s", files: [{ relativePath: "SKILL.md", content: "y" }] }],
      }),
    );
    expect(files).toEqual([]);
    expect(warnings.map((w) => w.artifact).sort()).toEqual(["skills", "subagents"]);
  });

  it("emits ~/.gemini files in a global run", async () => {
    const server: McpServer = {
      transport: "stdio",
      command: "npx",
      args: [],
      env: {},
      headers: {},
      scope: "project",
    };
    const { files } = await geminiAdapter.emit(
      makeContext({
        scope: "global",
        instructions: [{ name: "base", content: "Global rules.\n" }],
        mcpServers: { github: server },
        prompts: [{ name: "fix", content: "Fix it.\n" }],
      }),
    );
    expect(files.map((f) => [f.relativePath, f.scope])).toEqual([
      [".gemini/GEMINI.md", "global"],
      [".gemini/settings.json", "global"],
      [".gemini/commands/fix.toml", "global"],
    ]);
  });
});
