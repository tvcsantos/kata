import { Args, Flags } from "@oclif/core";
import pc from "picocolors";
import { displayAbsolutePath, openProject } from "@katahq/core";
import { loadProjectFromCwd } from "../context.js";
import { KATA_PLAN_HINT } from "../hints.js";
import { KataCommand } from "../kata-command.js";

export interface UninstallOptions {
  global?: boolean;
  json?: boolean;
}

export async function runUninstall(name: string, opts: UninstallOptions): Promise<void> {
  const project = await loadProjectFromCwd(opts.global ?? false);
  const kataProject = await openProject(project.rootDir, { scope: project.scope });
  const result = await kataProject.uninstall(name);

  if (opts.json) {
    console.log(JSON.stringify({ name, ...result }, null, 2));
    return;
  }

  console.log(pc.green(`Uninstalled ${name} (removed ${result.composeRef} from compose).`));
  if (result.removedDir) {
    console.log(`Deleted ${displayAbsolutePath(project.rootDir, project.scope, result.dir)}.`);
  }
  console.log(`Run ${pc.bold(KATA_PLAN_HINT(opts.global ?? false))} to update the native configs.`);
}

export class UninstallCommand extends KataCommand {
  static override description = "Remove an installed package from compose (deletes vendored dirs)";
  static override args = {
    name: Args.string({ required: true, description: "package name from kata-package.yaml" }),
  };
  static override flags = {
    global: Flags.boolean({
      char: "g",
      description: "uninstall from the user-level ~/.kata/ config",
    }),
    json: Flags.boolean({ description: "print the result as JSON" }),
  };

  override async run(): Promise<void> {
    const { args, flags } = await this.parse(UninstallCommand);
    await runUninstall(args.name, flags);
  }
}
