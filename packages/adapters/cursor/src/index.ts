import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  collectEnvRefs,
  emptyImportResult,
  exists,
  readNamedMarkdownFiles,
  readSkillDirs,
  readTextFileOrNull,
  stripFrontmatter,
  type Adapter,
  type AdapterContext,
  type AdapterWarning,
  type EmitResult,
  type EmittedFile,
  type ImportResult,
  type McpServer,
} from "@katahq/core";

const RULE_FILE = ".cursor/rules/kata.mdc";

/**
 * Cursor's mcp.json natively uses `${env:VAR}` interpolation - identical to
 * kata's syntax - so env values pass through unchanged.
 */
function renderServer(server: McpServer): Record<string, unknown> {
  if (server.transport === "stdio") {
    const result: Record<string, unknown> = { command: server.command };
    if (server.args.length > 0) result.args = server.args;
    if (Object.keys(server.env).length > 0) result.env = server.env;
    return result;
  }
  const result: Record<string, unknown> = { url: server.url };
  if (Object.keys(server.headers).length > 0) result.headers = server.headers;
  return result;
}

function composeInstructions(context: AdapterContext): string {
  return context.project.instructions.map((i) => i.content.trim()).join("\n\n");
}

export const cursorAdapter: Adapter = {
  id: "cursor",
  displayName: "Cursor",
  capabilities: {
    instructions: "full",
    mcpServers: "full",
    // Cursor commands are plain markdown, so prompt frontmatter is dropped.
    prompts: "partial",
    skills: "full",
    subagents: "unsupported",
  },

  async detect(context: AdapterContext): Promise<boolean> {
    return (
      (await exists(path.join(context.homeDir, ".cursor"))) ||
      (await exists(path.join(context.projectRoot, ".cursor")))
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
            "Cursor global rules live in the app settings (Cursor Settings → Rules), not in a file; skipped",
        });
      } else {
        // A rule file of our own, so we own it outright - no managed region needed.
        const frontmatter = [
          "---",
          "description: Project instructions managed by kata",
          "alwaysApply: true",
          "---",
        ].join("\n");
        files.push({
          relativePath: RULE_FILE,
          content: `${frontmatter}\n\n${instructions}\n`,
          strategy: { kind: "replace" },
        });
      }
    }

    // ~/.cursor/mcp.json and the project .cursor/mcp.json share a format;
    // only the base directory differs per scope.
    const rendered: Record<"project" | "global", Record<string, Record<string, unknown>>> = {
      project: {},
      global: {},
    };
    for (const [name, server] of Object.entries(context.project.mcpServers)) {
      if (
        server.transport !== "stdio" &&
        Object.values(server.headers).some((v) => collectEnvRefs(v).length > 0)
      ) {
        warnings.push({
          artifact: "mcpServers",
          message: `server "${name}": Cursor does not interpolate \${env:...} in remote server headers (known limitation); the literal string will be sent`,
        });
      }
      rendered[globalRun ? "global" : server.scope][name] = renderServer(server);
    }
    for (const scope of ["project", "global"] as const) {
      if (Object.keys(rendered[scope]).length === 0) continue;
      files.push({
        relativePath: ".cursor/mcp.json",
        scope,
        content: JSON.stringify({ mcpServers: rendered[scope] }),
        strategy: { kind: "json-merge" },
      });
    }

    for (const prompt of context.project.prompts) {
      files.push({
        relativePath: `.cursor/commands/${prompt.name}.md`,
        scope: context.scope,
        content: stripFrontmatter(prompt.content),
        strategy: { kind: "replace" },
      });
    }
    for (const skill of context.project.skills) {
      for (const file of skill.files) {
        files.push({
          relativePath: `.cursor/skills/${skill.name}/${file.relativePath}`,
          scope: context.scope,
          content: file.content,
          strategy: { kind: "replace" },
        });
      }
    }
    if (context.project.agents.length > 0) {
      warnings.push({
        artifact: "subagents",
        message: "Cursor subagent files are not supported yet, skipped",
      });
    }

    return { files, warnings };
  },

  async import(context: AdapterContext): Promise<ImportResult> {
    const result = emptyImportResult();
    const root = context.projectRoot;

    // Rules → instructions (frontmatter stripped); our own rule file excluded.
    const rulesDir = path.join(root, ".cursor", "rules");
    let ruleEntries: string[];
    try {
      ruleEntries = await readdir(rulesDir);
    } catch {
      ruleEntries = [];
    }
    for (const entry of ruleEntries.sort()) {
      if (!entry.endsWith(".mdc") || entry === "kata.mdc") continue;
      const content = await readFile(path.join(rulesDir, entry), "utf8");
      result.instructions.push({
        name: `imported-cursor-${entry.replace(/\.mdc$/, "")}`,
        content: stripFrontmatter(content),
      });
    }

    const mcpRaw = await readTextFileOrNull(path.join(root, ".cursor", "mcp.json"));
    if (mcpRaw !== null) {
      try {
        const parsed = JSON.parse(mcpRaw) as { mcpServers?: Record<string, unknown> };
        for (const [name, raw] of Object.entries(parsed.mcpServers ?? {})) {
          const server = importServer(raw);
          if (server) result.mcpServers[name] = server;
          else {
            result.warnings.push({
              artifact: "mcpServers",
              message: `server "${name}" in .cursor/mcp.json has an unrecognized shape, skipped`,
            });
          }
        }
      } catch {
        result.warnings.push({
          artifact: "mcpServers",
          message: ".cursor/mcp.json is not valid JSON, skipped",
        });
      }
    }

    result.prompts = await readNamedMarkdownFiles(path.join(root, ".cursor", "commands"));
    result.skills = await readSkillDirs(path.join(root, ".cursor", "skills"));

    return result;
  },
};

/** Cursor's `${env:VAR}` syntax already matches kata's; values import unchanged. */
function importServer(raw: unknown): McpServer | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.url === "string") {
    return {
      transport: "http",
      args: [],
      env: {},
      url: r.url,
      headers: (r.headers as Record<string, string>) ?? {},
      scope: "project",
    };
  }
  if (typeof r.command !== "string") return null;
  return {
    transport: "stdio",
    command: r.command,
    args: (r.args as string[]) ?? [],
    env: (r.env as Record<string, string>) ?? {},
    headers: {},
    scope: "project",
  };
}

export default cursorAdapter;
