import path from "node:path";
import {
  exists,
  parseFrontmatter,
  type Adapter,
  type AdapterContext,
  type AdapterWarning,
  type EmitResult,
  type EmittedFile,
  type McpServer,
} from "@katahq/core";

/**
 * VS Code's mcp.json natively supports `${env:VAR}` - identical to
 * kata's syntax - so values pass through unchanged.
 */
function renderServer(server: McpServer): Record<string, unknown> {
  if (server.transport === "stdio") {
    const result: Record<string, unknown> = { type: "stdio", command: server.command };
    if (server.args.length > 0) result.args = server.args;
    if (Object.keys(server.env).length > 0) result.env = server.env;
    return result;
  }
  const result: Record<string, unknown> = { type: server.transport, url: server.url };
  if (Object.keys(server.headers).length > 0) result.headers = server.headers;
  return result;
}

function composeInstructions(context: AdapterContext): string {
  return context.project.instructions.map((i) => i.content.trim()).join("\n\n");
}

/** VS Code's user config dir ("User profile"), relative to the home dir. */
function userDataDir(): string {
  switch (process.platform) {
    case "darwin":
      return "Library/Application Support/Code/User";
    case "win32":
      return "AppData/Roaming/Code/User";
    default:
      return ".config/Code/User";
  }
}

export const vscodeAdapter: Adapter = {
  id: "vscode",
  displayName: "VS Code",
  capabilities: {
    instructions: "full",
    mcpServers: "full",
    // Prompt files keep description + body; other frontmatter is dropped.
    prompts: "partial",
    skills: "full",
    subagents: "full",
  },

  async detect(context: AdapterContext): Promise<boolean> {
    return (
      (await exists(path.join(context.projectRoot, ".vscode"))) ||
      (await exists(path.join(context.homeDir, ".vscode")))
    );
  },

  async emit(context: AdapterContext): Promise<EmitResult> {
    const files: EmittedFile[] = [];
    const warnings: AdapterWarning[] = [];
    const globalRun = context.scope === "global";
    const profileDir = userDataDir();

    const instructions = composeInstructions(context);
    if (instructions.length > 0) {
      if (globalRun) {
        // User-level instructions: an *.instructions.md file in the profile
        // prompts folder, applied to every workspace. We own the file.
        files.push({
          relativePath: `${profileDir}/prompts/kata.instructions.md`,
          scope: "global",
          content: `---\napplyTo: "**"\n---\n\n${instructions}\n`,
          strategy: { kind: "replace" },
        });
      } else {
        files.push({
          relativePath: ".github/copilot-instructions.md",
          content: instructions,
          strategy: { kind: "managed-region" },
        });
      }
    }

    // User-level servers live in <profile>/mcp.json, same {servers} shape as
    // the workspace .vscode/mcp.json.
    const rendered: Record<"project" | "global", Record<string, Record<string, unknown>>> = {
      project: {},
      global: {},
    };
    for (const [name, server] of Object.entries(context.project.mcpServers)) {
      rendered[globalRun ? "global" : server.scope][name] = renderServer(server);
    }
    if (Object.keys(rendered.project).length > 0) {
      files.push({
        relativePath: ".vscode/mcp.json",
        content: JSON.stringify({ servers: rendered.project }),
        strategy: { kind: "json-merge" },
      });
    }
    if (Object.keys(rendered.global).length > 0) {
      files.push({
        relativePath: `${profileDir}/mcp.json`,
        scope: "global",
        content: JSON.stringify({ servers: rendered.global }),
        strategy: { kind: "json-merge" },
      });
    }

    for (const prompt of context.project.prompts) {
      const { data, body } = parseFrontmatter(prompt.content);
      const description = typeof data?.description === "string" ? data.description : null;
      const fm =
        description === null ? "" : `---\ndescription: ${JSON.stringify(description)}\n---\n\n`;
      files.push({
        relativePath: globalRun
          ? `${profileDir}/prompts/${prompt.name}.prompt.md`
          : `.github/prompts/${prompt.name}.prompt.md`,
        scope: context.scope,
        content: `${fm}${body.trim()}\n`,
        strategy: { kind: "replace" },
      });
    }

    if (globalRun) {
      if (context.project.agents.length > 0) {
        warnings.push({
          artifact: "subagents",
          message: "VS Code custom agents are project-scope only (.github/agents), skipped",
        });
      }
      if (context.project.skills.length > 0) {
        warnings.push({
          artifact: "skills",
          message: "VS Code skills are project-scope only (.github/skills), skipped",
        });
      }
      return { files, warnings };
    }

    // Same cross-tool locations Copilot uses; emitted by both adapters, the
    // deterministic output converges byte-for-byte.
    for (const agent of context.project.agents) {
      files.push({
        relativePath: `.github/agents/${agent.name}.agent.md`,
        content: agent.content,
        strategy: { kind: "replace" },
      });
    }
    for (const skill of context.project.skills) {
      for (const file of skill.files) {
        files.push({
          relativePath: `.github/skills/${skill.name}/${file.relativePath}`,
          content: file.content,
          strategy: { kind: "replace" },
        });
      }
    }

    return { files, warnings };
  },
};

export default vscodeAdapter;
