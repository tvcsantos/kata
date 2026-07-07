import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Flags } from "@oclif/core";
import pc from "picocolors";
import { parseDocument } from "yaml";
import {
  exists,
  makeAgentRelativePath,
  makeInstructionRelativePath,
  makeMcpServerPath,
  makePromptRelativePath,
  makeSkillDirRelativePath,
  MCP_SERVERS_SCHEMA_VERSION,
  readTextFileOrDefault,
} from "@katahq/core";
import type { Project, ImportResult, McpServer, Skill } from "@katahq/core";
import { buildRegistry, enabledAdapters, loadProjectFromCwd, makeContext } from "../context.js";
import { MCP_SERVERS_EMPTY_TEMPLATE } from "../templates.js";
import { KATA_PLAN_HINT } from "../hints.js";
import { KataCommand } from "../kata-command.js";

export interface ImportOptions {
  from?: string[];
  all?: boolean;
  force?: boolean;
}

/** Drop defaulted fields so imported YAML stays minimal. */
function slimServer(server: McpServer): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (server.transport !== "stdio") result.transport = server.transport;
  if (server.command) result.command = server.command;
  if (server.args.length > 0) result.args = server.args;
  if (Object.keys(server.env).length > 0) result.env = server.env;
  if (server.url) result.url = server.url;
  if (Object.keys(server.headers).length > 0) result.headers = server.headers;
  if (server.scope !== "project") result.scope = server.scope;
  return result;
}

interface Tally {
  written: string[];
  skipped: string[];
}

async function writeUnlessExists(
  dir: string,
  relativePath: string,
  content: string,
  force: boolean,
  tally: Tally,
): Promise<void> {
  const absolutePath = path.join(dir, relativePath);
  if (!force && (await exists(absolutePath))) {
    tally.skipped.push(relativePath);
    return;
  }
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
  tally.written.push(relativePath);
}

async function importFilesDefault<T extends { name: string; content: string }>(
  files: T[],
  makeRelativePath: (name: string) => string,
  dir: string,
  force: boolean,
  tally: Tally,
) {
  for (const file of files) {
    await writeUnlessExists(dir, makeRelativePath(file.name), file.content, force, tally);
  }
}

async function importSkills(skills: Skill[], dir: string, force: boolean, tally: Tally) {
  for (const skill of skills) {
    const relativeDir = makeSkillDirRelativePath(skill.name);
    const skillDir = path.join(dir, relativeDir);
    if (!force && (await exists(skillDir))) {
      tally.skipped.push(relativeDir);
      continue;
    }
    for (const file of skill.files) {
      await mkdir(path.dirname(path.join(skillDir, file.relativePath)), { recursive: true });
      await writeFile(path.join(skillDir, file.relativePath), file.content, "utf8");
    }
    tally.written.push(relativeDir);
  }
}

async function importMcpServers(
  mcpServers: Record<string, McpServer>,
  dir: string,
  force: boolean,
  tally: Tally,
) {
  const serverNames = Object.keys(mcpServers);
  if (serverNames.length > 0) {
    const serversPath = makeMcpServerPath(dir);
    const raw = await readTextFileOrDefault(serversPath, MCP_SERVERS_EMPTY_TEMPLATE);
    const doc = parseDocument(raw);
    if (doc.get("version") === undefined) doc.set("version", MCP_SERVERS_SCHEMA_VERSION);
    let changed = false;
    for (const name of serverNames.sort()) {
      if (doc.getIn(["servers", name]) !== undefined && !force) {
        tally.skipped.push(`mcp server "${name}"`);
        continue;
      }
      doc.setIn(["servers", name], doc.createNode(slimServer(mcpServers[name]!)));
      tally.written.push(`mcp server "${name}"`);
      changed = true;
    }
    if (changed) {
      await mkdir(path.dirname(serversPath), { recursive: true });
      await writeFile(serversPath, doc.toString(), "utf8");
    }
  }
}

async function applyImport(
  project: Project,
  result: ImportResult,
  force: boolean,
  tally: Tally,
): Promise<void> {
  const dir = project.configDir;
  await importFilesDefault(result.instructions, makeInstructionRelativePath, dir, force, tally);
  await importFilesDefault(result.prompts, makePromptRelativePath, dir, force, tally);
  await importFilesDefault(result.agents, makeAgentRelativePath, dir, force, tally);
  await importSkills(result.skills, dir, force, tally);
  await importMcpServers(result.mcpServers, dir, force, tally);
}

export async function runImport(opts: ImportOptions): Promise<void> {
  if (!opts.all && (!opts.from || opts.from.length === 0)) {
    throw new Error("Specify --from <target...> or --all.");
  }
  const project = await loadProjectFromCwd();
  const registry = await buildRegistry();

  let sources;
  if (opts.all) {
    sources = enabledAdapters(project, registry).adapters;
  } else {
    sources = (opts.from ?? []).map((id) => {
      const adapter = registry.get(id);
      if (!adapter) {
        throw new Error(
          `Unknown target "${id}" (known: ${registry
            .all()
            .map((a) => a.id)
            .join(", ")})`,
        );
      }
      return adapter;
    });
  }

  const importable = sources.filter((a) => a.import !== undefined);
  const skippedSources = sources.filter((a) => a.import === undefined);
  for (const adapter of skippedSources) {
    console.log(pc.yellow(`${adapter.id}: import not supported yet, skipped`));
  }
  if (importable.length === 0) {
    console.log(pc.yellow("Nothing to import from."));
    return;
  }

  const tally: Tally = { written: [], skipped: [] };
  for (const adapter of importable) {
    console.log(pc.bold(`importing from ${adapter.id}`));
    const result = await adapter.import!(makeContext(project, adapter));
    for (const w of result.warnings) console.log(pc.yellow(`  ! ${w.message}`));
    await applyImport(project, result, opts.force ?? false, tally);
  }

  for (const label of tally.written) console.log(pc.green(`  + ${label}`));
  for (const label of tally.skipped) {
    console.log(pc.dim(`  = ${label} already exists, skipped (use --force to overwrite)`));
  }
  if (tally.written.length === 0 && tally.skipped.length === 0) {
    console.log("Nothing found to import.");
    return;
  }
  console.log(
    `\nImported ${tally.written.length} artifact(s). Run ${pc.bold(KATA_PLAN_HINT(false))} to review.`,
  );
}

export class ImportCommand extends KataCommand {
  static override description = "Ingest existing native configs into .kata/";
  static override flags = {
    from: Flags.string({ multiple: true, description: "import from these targets" }),
    all: Flags.boolean({ description: "import from every enabled target" }),
    force: Flags.boolean({ description: "overwrite artifacts in .kata/ that already exist" }),
  };

  override async run(): Promise<void> {
    const { flags } = await this.parse(ImportCommand);
    await runImport(flags);
  }
}
