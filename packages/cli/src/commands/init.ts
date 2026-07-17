import { mkdir, writeFile } from "node:fs/promises";
import pc from "picocolors";
import {
  CONFIG_SCHEMA_VERSION,
  displayAbsolutePath,
  exists,
  getRootDir,
  makeConfigDirPath,
  makeConfigPath,
  makeInstructionPath,
  makeInstructionsDirPath,
  makeMcpDirPath,
  makeMcpServerPath,
  makeStandaloneContext,
} from "@katahq/core";
import { Flags } from "@oclif/core";
import { buildRegistry } from "../context.js";
import { SAMPLE_GLOBAL_INSTRUCTIONS, SAMPLE_INSTRUCTIONS, SAMPLE_SERVERS } from "../templates.js";
import { KATA_PLAN_HINT } from "../hints.js";
import { KataCommand } from "../kata-command.js";

export async function runInit(opts: { global?: boolean } = {}): Promise<void> {
  const global = opts.global ?? false;
  const scope = global ? ("global" as const) : ("project" as const);
  const rootDir = getRootDir(scope);
  const configDir = makeConfigDirPath(rootDir);
  const configPath = makeConfigPath(configDir);
  const show = (absolutePath: string) => displayAbsolutePath(rootDir, scope, absolutePath);
  if (await exists(configPath)) {
    console.log(`${show(configPath)} already exists - nothing to do.`);
    return;
  }

  const registry = await buildRegistry();
  const targetLines: string[] = [];
  for (const adapter of registry.all()) {
    const detected = await adapter.detect(makeStandaloneContext(rootDir, scope));
    targetLines.push(
      `  ${adapter.id}:`,
      `    enabled: ${detected}${detected ? "" : "  # not detected on this machine"}`,
    );
  }

  const configYaml = [`version: ${CONFIG_SCHEMA_VERSION}`, "targets:", ...targetLines, ""].join(
    "\n",
  );

  const instructionPath = makeInstructionPath(configDir, "base");
  const serversPath = makeMcpServerPath(configDir);
  await mkdir(makeInstructionsDirPath(configDir), { recursive: true });
  await mkdir(makeMcpDirPath(configDir), { recursive: true });
  await writeFile(configPath, configYaml, "utf8");
  await writeFile(
    instructionPath,
    global ? SAMPLE_GLOBAL_INSTRUCTIONS : SAMPLE_INSTRUCTIONS,
    "utf8",
  );
  await writeFile(serversPath, SAMPLE_SERVERS, "utf8");

  console.log(pc.green(`Initialized ${show(configDir)}`));
  console.log(`  ${show(configPath)}`);
  console.log(`  ${show(instructionPath)}`);
  console.log(`  ${show(serversPath)}`);
  console.log(
    `\nNext: edit ${show(instructionPath)}, then run ${pc.bold(KATA_PLAN_HINT(global))}.`,
  );
}

export class InitCommand extends KataCommand {
  static override description = "Scaffold .kata/ and detect installed tools";
  static override flags = {
    global: Flags.boolean({ char: "g", description: "initialize the user-level ~/.kata/ instead" }),
  };

  override async run(): Promise<void> {
    const { flags } = await this.parse(InitCommand);
    await runInit(flags);
  }
}
