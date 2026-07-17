import { Args, Flags } from "@oclif/core";
import pc from "picocolors";
import {
  displayAbsolutePath,
  openProject,
  parsePackageSource,
  type InstallResult,
  type PackageSource,
} from "@katahq/core";
import { loadProjectFromCwd } from "../context.js";
import { KATA_PLAN_HINT } from "../hints.js";
import { KataCommand } from "../kata-command.js";

export interface InstallOptions {
  name?: string;
  force?: boolean;
  global?: boolean;
  json?: boolean;
}

function installJson(source: PackageSource, result: InstallResult): string {
  return JSON.stringify(
    {
      name: result.package.manifest.name,
      version: result.package.manifest.version ?? null,
      source,
      composeRef: result.composeRef,
      dir: result.package.dir,
      addedToCompose: result.addedToCompose,
      vendoredCommit: result.vendoredCommit ?? null,
    },
    null,
    2,
  );
}

export async function runInstall(reference: string, opts: InstallOptions): Promise<void> {
  const project = await loadProjectFromCwd(opts.global ?? false);
  const kataProject = await openProject(project.rootDir, { scope: project.scope });
  const source = parsePackageSource(reference);

  const result = await kataProject.install(source, {
    name: opts.name,
    force: opts.force,
    onProgress: (progress) => {
      if (opts.json) return;
      if (progress.phase === "clone" && progress.url && progress.destinationDir) {
        const shownDir = displayAbsolutePath(
          project.rootDir,
          project.scope,
          progress.destinationDir,
        );
        console.log(`Cloning ${progress.url} into ${shownDir}…`);
      }
    },
  });

  if (opts.json) {
    console.log(installJson(source, result));
    return;
  }

  if (source.kind === "git") {
    const shownDir = displayAbsolutePath(project.rootDir, project.scope, result.package.dir);
    const version = result.package.manifest.version;
    console.log(
      pc.green(
        `Installed ${result.package.manifest.name}${version ? `@${version}` : ""} → ${shownDir}`,
      ),
    );
    if (!result.addedToCompose) console.log(`${result.composeRef} was already in compose.`);
  } else {
    console.log(
      result.addedToCompose
        ? `Added ${pc.bold(result.composeRef)} (${result.package.manifest.name}) to compose.`
        : `${pc.bold(result.composeRef)} is already in compose.`,
    );
  }
  console.log(`Run ${pc.bold(KATA_PLAN_HINT(opts.global ?? false))} to see what it changes.`);
}

export class InstallCommand extends KataCommand {
  static override description =
    "Install a shared config package (git URL, local path, or npm:<pkg> already in node_modules)";
  static override args = {
    ref: Args.string({ required: true, description: "git URL, local path, or npm:<pkg>" }),
  };
  static override flags = {
    name: Flags.string({ description: "directory name for git installs" }),
    force: Flags.boolean({ description: "replace an existing installed package" }),
    global: Flags.boolean({
      char: "g",
      description: "install into the user-level ~/.kata/ config",
    }),
    json: Flags.boolean({ description: "print the result as JSON" }),
  };

  override async run(): Promise<void> {
    const { args, flags } = await this.parse(InstallCommand);
    await runInstall(args.ref, flags);
  }
}
