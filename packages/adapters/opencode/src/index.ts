import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import {
  exists,
  parseFrontmatter,
  renderEnvRefs,
  type Adapter,
  type AdapterContext,
  type AdapterWarning,
  type EmitResult,
  type EmittedFile,
  type McpServer,
} from "@katahq/core";

/** OpenCode substitutes `{env:VAR}` in opencode.json values. */
function renderValue(value: string): string {
  return renderEnvRefs(value, (name) => `{env:${name}}`);
}

function renderServer(server: McpServer): Record<string, unknown> {
  if (server.transport === "stdio") {
    const result: Record<string, unknown> = {
      type: "local",
      // OpenCode takes executable + args as a single array.
      command: [server.command as string, ...server.args].map(renderValue),
      enabled: true,
    };
    if (Object.keys(server.env).length > 0) {
      result.environment = Object.fromEntries(
        Object.entries(server.env).map(([k, v]) => [k, renderValue(v)]),
      );
    }
    return result;
  }
  const result: Record<string, unknown> = {
    type: "remote",
    url: renderValue(server.url ?? ""),
    enabled: true,
  };
  if (Object.keys(server.headers).length > 0) {
    result.headers = Object.fromEntries(
      Object.entries(server.headers).map(([k, v]) => [k, renderValue(v)]),
    );
  }
  return result;
}

function composeInstructions(context: AdapterContext): string {
  return context.project.instructions.map((i) => i.content.trim()).join("\n\n");
}

export const opencodeAdapter: Adapter = {
  id: "opencode",
  displayName: "OpenCode",
  capabilities: {
    instructions: "full",
    mcpServers: "full",
    prompts: "full",
    skills: "full",
    // Subagent tools frontmatter differs (map vs list) and is dropped.
    subagents: "partial",
  },

  async detect(context: AdapterContext): Promise<boolean> {
    return (
      (await exists(path.join(context.homeDir, ".config", "opencode"))) ||
      (await exists(path.join(context.projectRoot, ".opencode"))) ||
      (await exists(path.join(context.projectRoot, "opencode.json")))
    );
  },

  async emit(context: AdapterContext): Promise<EmitResult> {
    const files: EmittedFile[] = [];
    const warnings: AdapterWarning[] = [];
    const globalRun = context.scope === "global";
    // OpenCode's user-level config lives under ~/.config/opencode.
    const globalDir = ".config/opencode";
    const artifactDir = globalRun ? globalDir : ".opencode";

    const instructions = composeInstructions(context);
    if (instructions.length > 0) {
      files.push({
        relativePath: globalRun ? `${globalDir}/AGENTS.md` : "AGENTS.md",
        scope: context.scope,
        content: instructions,
        strategy: { kind: "managed-region" },
      });
    }

    const rendered: Record<"project" | "global", Record<string, Record<string, unknown>>> = {
      project: {},
      global: {},
    };
    for (const [name, server] of Object.entries(context.project.mcpServers)) {
      rendered[globalRun ? "global" : server.scope][name] = renderServer(server);
    }
    for (const scope of ["project", "global"] as const) {
      if (Object.keys(rendered[scope]).length === 0) continue;
      files.push({
        relativePath: scope === "global" ? `${globalDir}/opencode.json` : "opencode.json",
        scope,
        content: JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          mcp: rendered[scope],
        }),
        strategy: { kind: "json-merge" },
      });
    }

    for (const prompt of context.project.prompts) {
      files.push({
        relativePath: `${artifactDir}/commands/${prompt.name}.md`,
        scope: context.scope,
        content: prompt.content,
        strategy: { kind: "replace" },
      });
    }

    for (const agent of context.project.agents) {
      const { data, body } = parseFrontmatter(agent.content);
      const fm: Record<string, unknown> = {};
      if (typeof data?.description === "string") fm.description = data.description;
      fm.mode = "subagent";
      if (typeof data?.model === "string") fm.model = data.model;
      if (data?.tools !== undefined) {
        warnings.push({
          artifact: "subagents",
          message: `agent "${agent.name}": OpenCode uses a different tools format; the tools restriction was dropped`,
        });
      }
      files.push({
        relativePath: `${artifactDir}/agents/${agent.name}.md`,
        scope: context.scope,
        content: `---\n${stringifyYaml(fm)}---\n\n${body.trim()}\n`,
        strategy: { kind: "replace" },
      });
    }

    for (const skill of context.project.skills) {
      for (const file of skill.files) {
        files.push({
          relativePath: `${artifactDir}/skills/${skill.name}/${file.relativePath}`,
          scope: context.scope,
          content: file.content,
          strategy: { kind: "replace" },
        });
      }
    }

    return { files, warnings };
  },
};

export default opencodeAdapter;
