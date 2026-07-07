import { readFile, writeFile } from "node:fs/promises";
import { Args, Flags } from "@oclif/core";
import pc from "picocolors";
import { parseDocument } from "yaml";
import { makeConfigPath } from "@katahq/core";
import { buildRegistry, loadProjectFromCwd, makeContext } from "../context.js";
import { KataCommand } from "../kata-command.js";

export async function runTargetsList(opts: { global?: boolean } = {}): Promise<void> {
  const project = await loadProjectFromCwd(opts.global ?? false);
  const registry = await buildRegistry();
  const ids = new Set([
    ...registry.all().map((adapter) => adapter.id),
    ...Object.keys(project.config.targets),
  ]);
  for (const id of [...ids].sort()) {
    const adapter = registry.get(id);
    const configured = project.config.targets[id];
    const enabled = configured?.enabled ?? false;
    const detected = adapter ? await adapter.detect(makeContext(project, adapter)) : false;
    const state = enabled ? pc.green("enabled ") : pc.dim("disabled");
    const flags = [
      adapter ? "" : pc.red("no adapter"),
      adapter && detected ? pc.dim("detected") : "",
    ]
      .filter(Boolean)
      .join(" ");
    console.log(`${state}  ${id.padEnd(16)} ${adapter?.displayName ?? ""} ${flags}`.trimEnd());
  }
}

export async function runTargetsSet(
  id: string,
  enabled: boolean,
  opts: { global?: boolean } = {},
): Promise<void> {
  const project = await loadProjectFromCwd(opts.global ?? false);
  const registry = await buildRegistry();
  if (!registry.get(id)) {
    console.error(
      pc.yellow(
        `warning: no adapter registered for "${id}" (known: ${registry
          .all()
          .map((adapter) => adapter.id)
          .join(", ")})`,
      ),
    );
  }
  const configPath = makeConfigPath(project.configDir);
  // Edit via the YAML document API so user comments survive.
  const document = parseDocument(await readFile(configPath, "utf8"));
  document.setIn(["targets", id, "enabled"], enabled);
  await writeFile(configPath, document.toString(), "utf8");
  console.log(`${enabled ? "Enabled" : "Disabled"} target ${pc.bold(id)}.`);
}

export class TargetsListCommand extends KataCommand {
  static override description = "List targets and their status";
  static override flags = {
    global: Flags.boolean({
      char: "g",
      description: "list targets of the user-level ~/.kata/ config",
    }),
  };

  override async run(): Promise<void> {
    const { flags } = await this.parse(TargetsListCommand);
    await runTargetsList(flags);
  }
}

export class TargetsEnableCommand extends KataCommand {
  static override description = "Enable a target in config.yaml";
  static override args = { id: Args.string({ required: true, description: "target id" }) };
  static override flags = {
    global: Flags.boolean({ char: "g", description: "edit the user-level ~/.kata/ config" }),
  };

  override async run(): Promise<void> {
    const { args, flags } = await this.parse(TargetsEnableCommand);
    await runTargetsSet(args.id, true, flags);
  }
}

export class TargetsDisableCommand extends KataCommand {
  static override description = "Disable a target in config.yaml";
  static override args = { id: Args.string({ required: true, description: "target id" }) };
  static override flags = {
    global: Flags.boolean({ char: "g", description: "edit the user-level ~/.kata/ config" }),
  };

  override async run(): Promise<void> {
    const { args, flags } = await this.parse(TargetsDisableCommand);
    await runTargetsSet(args.id, false, flags);
  }
}
