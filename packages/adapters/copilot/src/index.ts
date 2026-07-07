import path from "node:path";
import {
  exists,
  renderEnvRefs,
  type Adapter,
  type AdapterContext,
  type AdapterWarning,
  type EmitResult,
  type EmittedFile,
  type McpServer,
} from "@katahq/core";

/** Copilot CLI reads the shared `.mcp.json` format with `${VAR}` expansion. */
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
  } else {
    result.type = server.transport;
    result.url = renderValue(server.url ?? "");
    if (Object.keys(server.headers).length > 0) {
      result.headers = Object.fromEntries(
        Object.entries(server.headers).map(([k, v]) => [k, renderValue(v)]),
      );
    }
  }
  // Copilot gates MCP tools behind an allowlist; expose everything by default.
  result.tools = ["*"];
  return result;
}

function composeInstructions(context: AdapterContext): string {
  return context.project.instructions.map((i) => i.content.trim()).join("\n\n");
}

export const copilotAdapter: Adapter = {
  id: "copilot",
  displayName: "GitHub Copilot CLI",
  capabilities: {
    instructions: "full",
    mcpServers: "full",
    prompts: "unsupported",
    skills: "full",
    subagents: "full",
  },

  async detect(context: AdapterContext): Promise<boolean> {
    return (
      (await exists(path.join(context.homeDir, ".copilot"))) ||
      (await exists(path.join(context.projectRoot, ".github", "copilot-instructions.md")))
    );
  },

  async emit(context: AdapterContext): Promise<EmitResult> {
    const files: EmittedFile[] = [];
    const warnings: AdapterWarning[] = [];
    const globalRun = context.scope === "global";

    const instructions = composeInstructions(context);
    if (instructions.length > 0) {
      if (globalRun) {
        warnings.push({
          artifact: "instructions",
          message:
            "Copilot CLI has no user-level instructions file; instructions are project-scope only, skipped",
        });
      } else {
        files.push({
          relativePath: ".github/copilot-instructions.md",
          content: instructions,
          strategy: { kind: "managed-region" },
        });
      }
    }

    // User-level servers live in ~/.copilot/mcp-config.json (same shape as
    // the shared .mcp.json format).
    const rendered: Record<"project" | "global", Record<string, Record<string, unknown>>> = {
      project: {},
      global: {},
    };
    for (const [name, server] of Object.entries(context.project.mcpServers)) {
      rendered[globalRun ? "global" : server.scope][name] = renderServer(server);
    }
    if (Object.keys(rendered.project).length > 0) {
      files.push({
        relativePath: ".mcp.json",
        content: JSON.stringify({ mcpServers: rendered.project }),
        strategy: { kind: "json-merge" },
      });
    }
    if (Object.keys(rendered.global).length > 0) {
      files.push({
        relativePath: ".copilot/mcp-config.json",
        scope: "global",
        content: JSON.stringify({ mcpServers: rendered.global }),
        strategy: { kind: "json-merge" },
      });
    }

    if (context.project.prompts.length > 0) {
      warnings.push({
        artifact: "prompts",
        message: "Copilot CLI has no prompt files; consider converting prompts to skills",
      });
    }

    for (const agent of context.project.agents) {
      files.push({
        relativePath: globalRun
          ? `.copilot/agents/${agent.name}.agent.md`
          : `.github/agents/${agent.name}.agent.md`,
        scope: context.scope,
        content: agent.content,
        strategy: { kind: "replace" },
      });
    }
    if (globalRun && context.project.skills.length > 0) {
      warnings.push({
        artifact: "skills",
        message:
          "Copilot CLI has no user-level skills directory; skills are project-scope only, skipped",
      });
    }
    if (!globalRun) {
      for (const skill of context.project.skills) {
        for (const file of skill.files) {
          files.push({
            relativePath: `.github/skills/${skill.name}/${file.relativePath}`,
            content: file.content,
            strategy: { kind: "replace" },
          });
        }
      }
    }

    return { files, warnings };
  },
};

export default copilotAdapter;
