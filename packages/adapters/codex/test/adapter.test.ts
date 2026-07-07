import { describe, expect, it } from "vitest";
import type { AdapterContext, Project, McpServer } from "@katahq/core";
import { codexAdapter } from "@katahq/adapter-codex";

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
    config: { version: 1, targets: { codex: { enabled: true, options: {} } } },
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

describe("codex adapter emit", () => {
  it("emits AGENTS.md as a managed region", async () => {
    const context = makeContext({ instructions: [{ name: "a", content: "Be careful.\n" }] });
    const { files } = await codexAdapter.emit(context);
    const agents = files.find((f) => f.relativePath === "AGENTS.md");
    expect(agents?.strategy.kind).toBe("managed-region");
    expect(agents?.content).toBe("Be careful.");
  });

  it("maps same-name env refs to env_vars, literals to env (golden)", async () => {
    const server: McpServer = {
      ...base,
      transport: "stdio",
      command: "npx",
      args: ["-y", "server-github"],
      env: {
        GITHUB_TOKEN: "${env:GITHUB_TOKEN}",
        LOG_LEVEL: "debug",
      },
    };
    const { files, warnings } = await codexAdapter.emit(
      makeContext({ mcpServers: { github: server } }),
    );
    expect(warnings).toEqual([]);
    const toml = files.find((f) => f.relativePath === ".codex/config.toml");
    expect(toml?.strategy.kind).toBe("toml-merge");
    expect(JSON.parse(toml!.content)).toEqual({
      mcp_servers: {
        github: {
          command: "npx",
          args: ["-y", "server-github"],
          env: { LOG_LEVEL: "debug" },
          env_vars: ["GITHUB_TOKEN"],
        },
      },
    });
  });

  it("warns when an env ref cannot be mapped (renamed var)", async () => {
    const server: McpServer = {
      ...base,
      transport: "stdio",
      command: "x",
      env: { API_KEY: "${env:MY_OTHER_NAME}" },
    };
    const { files, warnings } = await codexAdapter.emit(makeContext({ mcpServers: { s: server } }));
    expect(warnings[0]?.message).toMatch(/no rename support/);
    const config = JSON.parse(files.find((f) => f.relativePath === ".codex/config.toml")!.content);
    expect(config.mcp_servers.s.env).toBeUndefined();
  });

  it("maps http auth headers to bearer_token_env_var and env_http_headers", async () => {
    const server: McpServer = {
      ...base,
      transport: "http",
      url: "https://mcp.example.com/mcp",
      headers: {
        Authorization: "Bearer ${env:EXAMPLE_TOKEN}",
        "X-Auth": "${env:AUTH_VALUE}",
        "X-Static": "hello",
      },
    };
    const { files, warnings } = await codexAdapter.emit(
      makeContext({ mcpServers: { remote: server } }),
    );
    expect(warnings).toEqual([]);
    const config = JSON.parse(files.find((f) => f.relativePath === ".codex/config.toml")!.content);
    expect(config.mcp_servers.remote).toEqual({
      url: "https://mcp.example.com/mcp",
      bearer_token_env_var: "EXAMPLE_TOKEN",
      http_headers: { "X-Static": "hello" },
      env_http_headers: { "X-Auth": "AUTH_VALUE" },
    });
  });

  it("emits skills to .codex/skills and warns on prompts/agents", async () => {
    const { files, warnings } = await codexAdapter.emit(
      makeContext({
        prompts: [{ name: "p", content: "x" }],
        agents: [{ name: "a", content: "y" }],
        skills: [{ name: "deploy", files: [{ relativePath: "SKILL.md", content: "Deploy.\n" }] }],
      }),
    );
    expect(files.map((f) => f.relativePath)).toEqual([".codex/skills/deploy/SKILL.md"]);
    expect(warnings.map((w) => w.artifact)).toEqual(["prompts", "subagents"]);
    expect(warnings[0]?.message).toMatch(/user-level only/);
  });

  it("routes global-scope servers to ~/.codex/config.toml", async () => {
    const projectServer: McpServer = { ...base, transport: "stdio", command: "a" };
    const globalServer: McpServer = { ...base, transport: "stdio", command: "b", scope: "global" };
    const { files } = await codexAdapter.emit(
      makeContext({ mcpServers: { local: projectServer, personal: globalServer } }),
    );
    const tomls = files.filter((f) => f.relativePath === ".codex/config.toml");
    expect(tomls).toHaveLength(2);
    const project = tomls.find((f) => (f.scope ?? "project") === "project");
    const global = tomls.find((f) => f.scope === "global");
    expect(Object.keys(JSON.parse(project!.content).mcp_servers)).toEqual(["local"]);
    expect(Object.keys(JSON.parse(global!.content).mcp_servers)).toEqual(["personal"]);
  });

  it("emits user-level files, including prompts, in a global run", async () => {
    const server: McpServer = { ...base, transport: "stdio", command: "npx" };
    const { files, warnings } = await codexAdapter.emit(
      makeContext({
        scope: "global",
        instructions: [{ name: "a", content: "Global rules.\n" }],
        mcpServers: { github: server },
        prompts: [{ name: "review", content: "Review it.\n" }],
        skills: [{ name: "deploy", files: [{ relativePath: "SKILL.md", content: "Deploy.\n" }] }],
      }),
    );
    expect(warnings).toEqual([]);
    expect(files.map((f) => [f.relativePath, f.scope])).toEqual([
      [".codex/AGENTS.md", "global"],
      [".codex/config.toml", "global"],
      [".codex/skills/deploy/SKILL.md", "global"],
      [".codex/prompts/review.md", "global"],
    ]);
  });

  it("skips sse servers with a warning", async () => {
    const server: McpServer = { ...base, transport: "sse", url: "https://x/sse" };
    const { files, warnings } = await codexAdapter.emit(makeContext({ mcpServers: { s: server } }));
    expect(files.find((f) => f.relativePath === ".codex/config.toml")).toBeUndefined();
    expect(warnings[0]?.message).toMatch(/SSE/);
  });
});
