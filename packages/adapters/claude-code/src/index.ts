import path from "node:path";
import {
  emptyImportResult,
  exists,
  readNamedMarkdownFiles,
  readSkillDirs,
  readTextFileOrNull,
  removeManagedRegion,
  renderEnvRefs,
  type Adapter,
  type AdapterContext,
  type AdapterWarning,
  type EmitResult,
  type EmittedFile,
  type ImportResult,
  type McpServer,
} from "@katahq/core";

/** Claude Code expands `${VAR}` in .mcp.json values at load time. */
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
  return result;
}

function composeInstructions(context: AdapterContext): string {
  return context.project.instructions.map((i) => i.content.trim()).join("\n\n");
}

export const claudeCodeAdapter: Adapter = {
  id: "claude-code",
  displayName: "Claude Code",
  capabilities: {
    instructions: "full",
    mcpServers: "full",
    prompts: "full",
    subagents: "full",
    skills: "full",
  },

  async detect(context: AdapterContext): Promise<boolean> {
    return (
      (await exists(path.join(context.homeDir, ".claude"))) ||
      (await exists(path.join(context.projectRoot, ".claude"))) ||
      (await exists(path.join(context.projectRoot, "CLAUDE.md")))
    );
  },

  async emit(context: AdapterContext): Promise<EmitResult> {
    const files: EmittedFile[] = [];
    const warnings: AdapterWarning[] = [];
    const globalRun = context.scope === "global";

    const instructions = composeInstructions(context);
    if (instructions.length > 0) {
      files.push({
        relativePath: globalRun ? ".claude/CLAUDE.md" : "CLAUDE.md",
        scope: context.scope,
        content: instructions,
        strategy: { kind: "managed-region" },
      });
    }

    // In a global run every server is user-level; in a project run only the
    // servers marked `scope: global` go to the user-level config.
    const entries = Object.entries(context.project.mcpServers);
    const projectServers = globalRun ? [] : entries.filter(([, s]) => s.scope === "project");
    const globalServers = globalRun ? entries : entries.filter(([, s]) => s.scope === "global");
    if (projectServers.length > 0) {
      const fragment = {
        mcpServers: Object.fromEntries(
          projectServers.map(([name, server]) => [name, renderServer(server)]),
        ),
      };
      files.push({
        relativePath: ".mcp.json",
        content: JSON.stringify(fragment),
        strategy: { kind: "json-merge" },
      });
    }
    if (globalServers.length > 0) {
      // User-scope servers live in ~/.claude.json (the same file `claude mcp
      // add --scope user` writes); merge preserves the rest of its state.
      const fragment = {
        mcpServers: Object.fromEntries(
          globalServers.map(([name, server]) => [name, renderServer(server)]),
        ),
      };
      files.push({
        relativePath: ".claude.json",
        scope: "global",
        content: JSON.stringify(fragment),
        strategy: { kind: "json-merge" },
      });
    }

    for (const prompt of context.project.prompts) {
      files.push({
        relativePath: `.claude/commands/${prompt.name}.md`,
        scope: context.scope,
        content: prompt.content,
        strategy: { kind: "replace" },
      });
    }
    for (const agent of context.project.agents) {
      files.push({
        relativePath: `.claude/agents/${agent.name}.md`,
        scope: context.scope,
        content: agent.content,
        strategy: { kind: "replace" },
      });
    }
    for (const skill of context.project.skills) {
      for (const file of skill.files) {
        files.push({
          relativePath: `.claude/skills/${skill.name}/${file.relativePath}`,
          scope: context.scope,
          content: file.content,
          strategy: { kind: "replace" },
        });
      }
    }

    return { files, warnings };
  },

  async import(context: AdapterContext): Promise<ImportResult> {
    const result = emptyImportResult();
    const root = context.projectRoot;

    const claudeMd = await readTextFileOrNull(path.join(root, "CLAUDE.md"));
    if (claudeMd !== null) {
      const own = removeManagedRegion(claudeMd);
      if (own.trim() !== "") {
        result.instructions.push({ name: "imported-claude-code", content: own });
      }
    }

    const mcpRaw = await readTextFileOrNull(path.join(root, ".mcp.json"));
    if (mcpRaw !== null) {
      try {
        const parsed = JSON.parse(mcpRaw) as { mcpServers?: Record<string, unknown> };
        for (const [name, raw] of Object.entries(parsed.mcpServers ?? {})) {
          const server = importServer(raw);
          if (server) result.mcpServers[name] = server;
          else {
            result.warnings.push({
              artifact: "mcpServers",
              message: `server "${name}" in .mcp.json has an unrecognized shape, skipped`,
            });
          }
        }
      } catch {
        result.warnings.push({
          artifact: "mcpServers",
          message: ".mcp.json is not valid JSON, skipped",
        });
      }
    }

    result.prompts = await readNamedMarkdownFiles(path.join(root, ".claude", "commands"));
    result.agents = await readNamedMarkdownFiles(path.join(root, ".claude", "agents"));
    result.skills = await readSkillDirs(path.join(root, ".claude", "skills"));

    return result;
  },
};

/** Claude Code `${VAR}` expansion -> kata's `${env:VAR}`. */
function toKataEnvRefs(value: string): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => `\${env:${name}}`);
}

function mapValues(obj: Record<string, string>, fn: (v: string) => string): Record<string, string> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));
}

function importServer(raw: unknown): McpServer | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const type = typeof r.type === "string" ? r.type : "stdio";
  if (type === "http" || type === "sse") {
    if (typeof r.url !== "string") return null;
    return {
      transport: type,
      args: [],
      env: {},
      url: toKataEnvRefs(r.url),
      headers: mapValues((r.headers as Record<string, string>) ?? {}, toKataEnvRefs),
      scope: "project",
    };
  }
  if (type !== "stdio" || typeof r.command !== "string") return null;
  return {
    transport: "stdio",
    command: r.command,
    args: ((r.args as string[]) ?? []).map(toKataEnvRefs),
    env: mapValues((r.env as Record<string, string>) ?? {}, toKataEnvRefs),
    headers: {},
    scope: "project",
  };
}

export default claudeCodeAdapter;
