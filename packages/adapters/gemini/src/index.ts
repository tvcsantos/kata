import path from "node:path";
import { stringify as stringifyToml } from "smol-toml";
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

/** Gemini CLI expands `${VAR}` (and `$VAR`) in settings.json values. */
function renderValue(value: string): string {
  return renderEnvRefs(value, (name) => `\${${name}}`);
}

function renderServer(server: McpServer): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (server.transport === "stdio") {
    result.command = server.command;
    if (server.args.length > 0) result.args = server.args.map(renderValue);
    if (Object.keys(server.env).length > 0) {
      result.env = Object.fromEntries(
        Object.entries(server.env).map(([k, v]) => [k, renderValue(v)]),
      );
    }
    return result;
  }
  // Gemini distinguishes streamable HTTP (httpUrl) from SSE (url).
  if (server.transport === "http") result.httpUrl = renderValue(server.url ?? "");
  else result.url = renderValue(server.url ?? "");
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

export const geminiAdapter: Adapter = {
  id: "gemini",
  displayName: "Gemini CLI",
  capabilities: {
    instructions: "full",
    mcpServers: "full",
    // TOML commands keep description + prompt; other frontmatter is dropped.
    prompts: "partial",
    skills: "unsupported",
    subagents: "unsupported",
  },

  async detect(context: AdapterContext): Promise<boolean> {
    return (
      (await exists(path.join(context.homeDir, ".gemini"))) ||
      (await exists(path.join(context.projectRoot, ".gemini"))) ||
      (await exists(path.join(context.projectRoot, "GEMINI.md")))
    );
  },

  async emit(context: AdapterContext): Promise<EmitResult> {
    const files: EmittedFile[] = [];
    const warnings: AdapterWarning[] = [];
    const globalRun = context.scope === "global";

    const instructions = composeInstructions(context);
    if (instructions.length > 0) {
      files.push({
        relativePath: globalRun ? ".gemini/GEMINI.md" : "GEMINI.md",
        scope: context.scope,
        content: instructions,
        strategy: { kind: "managed-region" },
      });
    }

    // ~/.gemini/settings.json and the project .gemini/settings.json share a
    // format; only the base directory differs per scope.
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
        relativePath: ".gemini/settings.json",
        scope,
        content: JSON.stringify({ mcpServers: rendered[scope] }),
        strategy: { kind: "json-merge" },
      });
    }

    for (const prompt of context.project.prompts) {
      const { data, body } = parseFrontmatter(prompt.content);
      const command: Record<string, unknown> = {};
      const description = data?.description;
      if (typeof description === "string") command.description = description;
      // Gemini's argument placeholder is {{args}}; Claude-style prompts use $ARGUMENTS.
      command.prompt = body.trim().replaceAll("$ARGUMENTS", "{{args}}") + "\n";
      files.push({
        relativePath: `.gemini/commands/${prompt.name}.toml`,
        scope: context.scope,
        content: stringifyToml(command) + "\n",
        strategy: { kind: "replace" },
      });
    }

    if (context.project.skills.length > 0) {
      warnings.push({
        artifact: "skills",
        message: "Gemini CLI does not support agent skills, skipped",
      });
    }
    if (context.project.agents.length > 0) {
      warnings.push({
        artifact: "subagents",
        message: "Gemini CLI does not support subagent definitions, skipped",
      });
    }

    return { files, warnings };
  },
};

export default geminiAdapter;
