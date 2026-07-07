import { access, constants } from "node:fs/promises";
import path from "node:path";
import { Flags } from "@oclif/core";
import pc from "picocolors";
import { collectEnvRefs, type Project } from "@katahq/core";
import { buildRegistry, enabledAdapters, loadProjectFromCwd, makeContext } from "../context.js";
import { KataCommand } from "../kata-command.js";

const WIN32_PATH_SUFFIXES = [".exe", ".cmd", ".bat", ""];

async function commandOnPath(command: string): Promise<boolean> {
  if (command.includes(path.sep)) {
    return access(command, constants.X_OK).then(
      () => true,
      () => false,
    );
  }
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const suffixes = process.platform === "win32" ? WIN32_PATH_SUFFIXES : [""];
  for (const dir of dirs) {
    for (const suffix of suffixes) {
      const ok = await access(path.join(dir, command + suffix), constants.X_OK).then(
        () => true,
        () => false,
      );
      if (ok) return true;
    }
  }
  return false;
}

function referencedEnvVars(project: Project): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  const note = (vars: string[], where: string) => {
    for (const v of vars) {
      const list = refs.get(v) ?? [];
      list.push(where);
      refs.set(v, list);
    }
  };
  for (const [name, server] of Object.entries(project.mcpServers)) {
    for (const [k, v] of Object.entries(server.env)) note(collectEnvRefs(v), `${name}.env.${k}`);
    for (const [k, v] of Object.entries(server.headers))
      note(collectEnvRefs(v), `${name}.headers.${k}`);
    for (const a of server.args) note(collectEnvRefs(a), `${name}.args`);
    if (server.url) note(collectEnvRefs(server.url), `${name}.url`);
  }
  return refs;
}

export async function runDoctor(opts: { global?: boolean } = {}): Promise<void> {
  const ok = (msg: string) => console.log(`${pc.green("✓")} ${msg}`);
  const warn = (msg: string) => console.log(`${pc.yellow("!")} ${msg}`);
  const fail = (msg: string) => {
    console.log(`${pc.red("✗")} ${msg}`);
    process.exitCode = 1;
  };

  let project: Project;
  try {
    project = await loadProjectFromCwd(opts.global ?? false);
    ok("kata config loads and validates");
  } catch (err) {
    fail((err as Error).message);
    return;
  }

  const registry = await buildRegistry();
  const { adapters, unknown } = enabledAdapters(project, registry);
  for (const id of unknown) {
    fail(`target "${id}" is enabled but no adapter is registered for it`);
  }
  if (adapters.length === 0) warn("no targets enabled");

  for (const adapter of adapters) {
    const context = makeContext(project, adapter);
    const detected = await adapter.detect(context);
    if (detected) ok(`${adapter.id}: detected on this machine`);
    else warn(`${adapter.id}: enabled but not detected on this machine`);
    const { warnings } = await adapter.emit(context);
    for (const warning of warnings) warn(`${adapter.id}: ${warning.message}`);
  }

  for (const [varName, sites] of referencedEnvVars(project)) {
    if (process.env[varName] === undefined) {
      warn(`env var ${varName} is referenced (${sites.join(", ")}) but not set in this shell`);
    } else {
      ok(`env var ${varName} is set`);
    }
  }

  for (const [name, server] of Object.entries(project.mcpServers)) {
    if (server.transport !== "stdio" || !server.command) continue;
    if (await commandOnPath(server.command))
      ok(`mcp server "${name}": command "${server.command}" found on PATH`);
    else warn(`mcp server "${name}": command "${server.command}" not found on PATH`);
  }

  if (process.exitCode !== 1) {
    console.log(pc.bold("\nDoctor finished. Warnings (if any) are informational."));
  }
}

export class DoctorCommand extends KataCommand {
  static override description = "Check environment: env vars, MCP commands, capability warnings";
  static override flags = {
    global: Flags.boolean({ char: "g", description: "check the user-level ~/.kata/ config" }),
  };

  override async run(): Promise<void> {
    const { flags } = await this.parse(DoctorCommand);
    await runDoctor(flags);
  }
}
