import path from "node:path";
import {
  collectEnvRefs,
  exists,
  pureEnvRef,
  type Adapter,
  type AdapterContext,
  type AdapterWarning,
  type EmitResult,
  type EmittedFile,
  type McpServer,
} from "@katahq/core";

interface RenderedServer {
  config: Record<string, unknown> | null;
  warnings: string[];
}

/**
 * Codex config.toml has no string interpolation, but it can source whole
 * values from the parent environment: `env_vars` forwards env vars to stdio
 * servers, `bearer_token_env_var` / `env_http_headers` populate HTTP auth.
 * We map `${env:VAR}` references onto those; anything that would force us to
 * inline a secret becomes a warning instead.
 */
function renderServer(name: string, server: McpServer): RenderedServer {
  const warnings: string[] = [];

  if (server.transport === "sse") {
    return {
      config: null,
      warnings: [`server "${name}": Codex does not support SSE transport, skipped`],
    };
  }

  if (server.transport === "stdio") {
    const config: Record<string, unknown> = { command: server.command };
    if (server.args.length > 0) config.args = server.args;
    for (const arg of server.args) {
      if (collectEnvRefs(arg).length > 0) {
        warnings.push(
          `server "${name}": Codex cannot expand env references in args ("${arg}"); passed through literally`,
        );
      }
    }
    const literalEnv: Record<string, string> = {};
    const forwardedVars: string[] = [];
    for (const [key, value] of Object.entries(server.env)) {
      const ref = pureEnvRef(value);
      if (ref !== null) {
        if (ref === key) {
          forwardedVars.push(key);
        } else {
          warnings.push(
            `server "${name}": Codex cannot map env ${key}=\${env:${ref}} (no rename support); set it manually in .codex/config.toml`,
          );
        }
      } else if (collectEnvRefs(value).length > 0) {
        warnings.push(
          `server "${name}": Codex cannot interpolate env references inside "${key}"; set it manually in .codex/config.toml`,
        );
      } else {
        literalEnv[key] = value;
      }
    }
    if (Object.keys(literalEnv).length > 0) config.env = literalEnv;
    if (forwardedVars.length > 0) config.env_vars = forwardedVars;
    return { config, warnings };
  }

  // http
  const config: Record<string, unknown> = { url: server.url };
  const staticHeaders: Record<string, string> = {};
  const envHeaders: Record<string, string> = {};
  for (const [header, value] of Object.entries(server.headers)) {
    const bearer = /^Bearer\s+(.+)$/.exec(value.trim());
    const bearerRef = bearer ? pureEnvRef(bearer[1] as string) : null;
    if (header.toLowerCase() === "authorization" && bearerRef !== null) {
      config.bearer_token_env_var = bearerRef;
      continue;
    }
    const ref = pureEnvRef(value);
    if (ref !== null) {
      envHeaders[header] = ref;
    } else if (collectEnvRefs(value).length > 0) {
      warnings.push(
        `server "${name}": Codex cannot interpolate env references inside header "${header}"; set it manually in .codex/config.toml`,
      );
    } else {
      staticHeaders[header] = value;
    }
  }
  if (Object.keys(staticHeaders).length > 0) config.http_headers = staticHeaders;
  if (Object.keys(envHeaders).length > 0) config.env_http_headers = envHeaders;
  return { config, warnings };
}

function composeInstructions(context: AdapterContext): string {
  return context.project.instructions.map((i) => i.content.trim()).join("\n\n");
}

export const codexAdapter: Adapter = {
  id: "codex",
  displayName: "Codex CLI",
  capabilities: {
    instructions: "full",
    mcpServers: "partial",
    skills: "full",
    prompts: "unsupported",
    subagents: "unsupported",
  },

  async detect(context: AdapterContext): Promise<boolean> {
    return (
      (await exists(path.join(context.homeDir, ".codex"))) ||
      (await exists(path.join(context.projectRoot, ".codex"))) ||
      (await exists(path.join(context.projectRoot, "AGENTS.md")))
    );
  },

  async emit(context: AdapterContext): Promise<EmitResult> {
    const files: EmittedFile[] = [];
    const warnings: AdapterWarning[] = [];
    const globalRun = context.scope === "global";

    const instructions = composeInstructions(context);
    if (instructions.length > 0) {
      files.push({
        relativePath: globalRun ? ".codex/AGENTS.md" : "AGENTS.md",
        scope: context.scope,
        content: instructions,
        strategy: { kind: "managed-region" },
      });
    }

    // ~/.codex/config.toml is the only place Codex reads MCP servers from,
    // so both global runs and project servers marked `scope: global` land
    // there; project-scope servers go to the repo's .codex/config.toml.
    const renderedByScope: Record<"project" | "global", Record<string, Record<string, unknown>>> = {
      project: {},
      global: {},
    };
    for (const [name, server] of Object.entries(context.project.mcpServers)) {
      const { config, warnings: serverWarnings } = renderServer(name, server);
      for (const message of serverWarnings) {
        warnings.push({ artifact: "mcpServers", message });
      }
      if (config) renderedByScope[globalRun ? "global" : server.scope][name] = config;
    }
    if (Object.keys(renderedByScope.project).length > 0) {
      files.push({
        relativePath: ".codex/config.toml",
        content: JSON.stringify({ mcp_servers: renderedByScope.project }),
        strategy: { kind: "toml-merge" },
      });
    }
    if (Object.keys(renderedByScope.global).length > 0) {
      files.push({
        relativePath: ".codex/config.toml",
        scope: "global",
        content: JSON.stringify({ mcp_servers: renderedByScope.global }),
        strategy: { kind: "toml-merge" },
      });
    }

    for (const skill of context.project.skills) {
      for (const file of skill.files) {
        files.push({
          relativePath: `.codex/skills/${skill.name}/${file.relativePath}`,
          scope: context.scope,
          content: file.content,
          strategy: { kind: "replace" },
        });
      }
    }
    if (context.project.prompts.length > 0) {
      if (globalRun) {
        // Codex custom prompts are user-level only, so a global run can emit them.
        for (const prompt of context.project.prompts) {
          files.push({
            relativePath: `.codex/prompts/${prompt.name}.md`,
            scope: "global",
            content: prompt.content,
            strategy: { kind: "replace" },
          });
        }
      } else {
        warnings.push({
          artifact: "prompts",
          message:
            "Codex custom prompts are user-level only; apply with --global or convert prompts to skills",
        });
      }
    }
    if (context.project.agents.length > 0) {
      warnings.push({
        artifact: "subagents",
        message: "Codex does not support subagent definitions, skipped",
      });
    }

    return { files, warnings };
  },
};

export default codexAdapter;
