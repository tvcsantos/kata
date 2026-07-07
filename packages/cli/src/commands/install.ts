import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Args, Flags } from "@oclif/core";
import pc from "picocolors";
import { parseDocument, YAMLSeq } from "yaml";
import {
  displayAbsolutePath,
  exists,
  loadPackage,
  makeConfigPathFromRoot,
  makeLocalComposeRef,
  PACKAGE_MANIFEST_NAME,
  PACKAGES_DIR_NAME,
} from "@katahq/core";
import { loadProjectFromCwd } from "../context.js";
import { KATA_PLAN_HINT } from "../hints.js";
import { KataCommand } from "../kata-command.js";

const exec = promisify(execFile);

export interface InstallOptions {
  name?: string;
  force?: boolean;
  global?: boolean;
}

function isGitRef(ref: string): boolean {
  return (
    ref.startsWith("https://") ||
    ref.startsWith("git@") ||
    ref.startsWith("ssh://") ||
    ref.startsWith("file://") ||
    ref.endsWith(".git")
  );
}

function slugFromUrl(url: string): string {
  const base = url.replace(/\/+$/, "").split(/[/:]/).pop() ?? "package";
  return base
    .replace(/\.git$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-");
}

async function appendComposeRef(rootDir: string, composeRef: string): Promise<boolean> {
  const configPath = makeConfigPathFromRoot(rootDir);
  const doc = parseDocument(await readFile(configPath, "utf8"));
  let compose = doc.get("compose", true);
  if (!(compose instanceof YAMLSeq)) {
    doc.set("compose", doc.createNode([]));
    compose = doc.get("compose", true);
  }
  const items = (compose as YAMLSeq).items.map((item) =>
    String((item as { value?: unknown }).value ?? item),
  );
  if (items.includes(composeRef)) return false;
  (compose as YAMLSeq).add(doc.createNode(composeRef));
  await writeFile(configPath, doc.toString(), "utf8");
  return true;
}

export async function runInstall(ref: string, opts: InstallOptions): Promise<void> {
  const project = await loadProjectFromCwd(opts.global ?? false);

  if (ref.startsWith("npm:")) {
    // Verify the package is installed and valid, then just wire up compose.
    const pkg = await loadPackage(ref, project.rootDir);
    const added = await appendComposeRef(project.rootDir, ref);
    console.log(
      added
        ? `Added ${pc.bold(ref)} (${pkg.manifest.name}) to compose.`
        : `${pc.bold(ref)} is already in compose.`,
    );
    console.log(`Run ${pc.bold(KATA_PLAN_HINT(false))} to see what it changes.`);
    return;
  }

  if (!isGitRef(ref)) {
    throw new Error(
      `Unsupported ref "${ref}". Use a git URL, or "npm:<package>" after installing it with your package manager.`,
    );
  }

  const slug = opts.name ?? slugFromUrl(ref);
  const absoluteDir = path.join(project.configDir, PACKAGES_DIR_NAME, slug);
  const shownDir = displayAbsolutePath(project.rootDir, project.scope, absoluteDir);
  if (await exists(absoluteDir)) {
    if (!opts.force) {
      throw new Error(`${shownDir} already exists (use --force to replace it).`);
    }
    await rm(absoluteDir, { recursive: true, force: true });
  }

  await mkdir(path.dirname(absoluteDir), { recursive: true });
  console.log(`Cloning ${ref} into ${shownDir}…`);
  try {
    await exec("git", ["clone", "--depth", "1", ref, absoluteDir]);
  } catch (err) {
    throw new Error(`git clone failed: ${(err as Error).message}`, { cause: err });
  }
  // Vendor the content: the package is committed with the repo, not a submodule.
  await rm(path.join(absoluteDir, ".git"), { recursive: true, force: true });

  if (!(await exists(path.join(absoluteDir, PACKAGE_MANIFEST_NAME)))) {
    await rm(absoluteDir, { recursive: true, force: true });
    throw new Error(`${ref} is not an kata package (no ${PACKAGE_MANIFEST_NAME} at its root).`);
  }

  const composeRef = makeLocalComposeRef(project.rootDir, absoluteDir);
  const pkg = await loadPackage(composeRef, project.rootDir);
  const added = await appendComposeRef(project.rootDir, composeRef);
  console.log(
    pc.green(
      `Installed ${pkg.manifest.name}${pkg.manifest.version ? `@${pkg.manifest.version}` : ""} → ${shownDir}`,
    ),
  );
  if (!added) console.log(`${composeRef} was already in compose.`);
  console.log(`Run ${pc.bold(KATA_PLAN_HINT(false))} to see what it changes.`);
}

export class InstallCommand extends KataCommand {
  static override description =
    "Install a shared config package (git URL, or npm:<pkg> already in node_modules)";
  static override args = {
    ref: Args.string({ required: true, description: "git URL, or npm:<pkg>" }),
  };
  static override flags = {
    name: Flags.string({ description: "directory name for git installs" }),
    force: Flags.boolean({ description: "replace an existing installed package" }),
    global: Flags.boolean({
      char: "g",
      description: "install into the user-level ~/.kata/ config",
    }),
  };

  override async run(): Promise<void> {
    const { args, flags } = await this.parse(InstallCommand);
    await runInstall(args.ref, flags);
  }
}
