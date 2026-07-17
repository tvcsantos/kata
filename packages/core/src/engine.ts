import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parse as parseYaml, parseDocument, stringify as stringifyYaml, YAMLSeq } from "yaml";
import { z } from "zod";
import type { Adapter, AdapterContext, Scope } from "./adapter.js";
import { applyPlan, type ApplyResult } from "./apply.js";
import { exists } from "./fs.js";
import { displayAbsolutePath, planAll, type Plan } from "./plan.js";
import {
  emptyArtifacts,
  loadArtifactsFromDir,
  loadPackage,
  loadProject,
  makeConfigDirPath,
  makeConfigPathFromRoot,
  makeLocalComposeRef,
  mergeArtifacts,
  PACKAGE_MANIFEST_NAME,
  PACKAGES_DIR_NAME,
  type LoadedPackage,
  type Project,
} from "./project.js";
import { CONFIG_SCHEMA_VERSION } from "./schema.js";

const exec = promisify(execFile);

/**
 * The programmatic engine surface: everything `kata install` / `plan` /
 * `apply` do, callable from code. The CLI and the desktop app both consume
 * this so their behavior can never diverge.
 */

export type PackageSource =
  | {
      kind: "git";
      url: string;
      /** Bundle directory inside the repo, for monorepos of bundles. */
      subdir?: string;
    }
  | { kind: "npm"; packageName: string }
  | { kind: "path"; path: string };

function isGitUrl(reference: string): boolean {
  return (
    reference.startsWith("https://") ||
    reference.startsWith("git@") ||
    reference.startsWith("ssh://") ||
    reference.startsWith("file://") ||
    reference.endsWith(".git")
  );
}

/**
 * Classify a user-supplied package reference: a git URL (optionally
 * `git+`-prefixed, as registries write them; `#path:<dir>` selects a
 * bundle directory inside a monorepo), `npm:<package>`, or a local path
 * (`./`, `../`, or absolute).
 */
export function parsePackageSource(reference: string): PackageSource {
  if (reference.startsWith("npm:")) {
    return { kind: "npm", packageName: reference.slice("npm:".length) };
  }
  const withoutScheme = reference.startsWith("git+") ? reference.slice("git+".length) : reference;
  const pathMarker = withoutScheme.indexOf("#path:");
  const url = pathMarker === -1 ? withoutScheme : withoutScheme.slice(0, pathMarker);
  if (isGitUrl(url)) {
    if (pathMarker === -1) return { kind: "git", url };
    const subdir = withoutScheme.slice(pathMarker + "#path:".length).replace(/^\/+|\/+$/g, "");
    return subdir === "" ? { kind: "git", url } : { kind: "git", url, subdir };
  }
  if (reference.startsWith("./") || reference.startsWith("../") || path.isAbsolute(reference)) {
    return { kind: "path", path: reference };
  }
  throw new Error(
    `Unsupported ref "${reference}". Use a git URL, a local path, or "npm:<package>" after installing it with your package manager.`,
  );
}

/** The default directory name for a git install, from the URL's last segment. */
export function slugFromGitUrl(url: string): string {
  const base = url.replace(/\/+$/, "").split(/[/:]/).pop() ?? "package";
  return base
    .replace(/\.git$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-");
}

/** Clone `url` into `destinationDir` and report the checked-out commit. */
export type GitClone = (url: string, destinationDir: string) => Promise<{ commit: string | null }>;

/** Default GitClone: shallow-clone with the system `git` binary. */
export const systemGitClone: GitClone = async (url, destinationDir) => {
  try {
    await exec("git", ["clone", "--depth", "1", url, destinationDir]);
  } catch (err) {
    throw new Error(`git clone failed: ${(err as Error).message}`, { cause: err });
  }
  let commit: string | null;
  try {
    const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: destinationDir });
    commit = stdout.trim();
  } catch {
    commit = null;
  }
  return { commit };
};

/**
 * Provenance of a vendored git install, written next to the vendored
 * content (`.kata-source.yaml`) so update checks can compare the pinned
 * commit against the source without any state outside the repo.
 */
const VENDORED_SOURCE_FILE_NAME = ".kata-source.yaml";

const vendoredSourceSchema = z.object({
  url: z.string(),
  commit: z.string().nullable().default(null),
  /** Present when the bundle lives in a subdirectory of its repo. */
  subdir: z.string().nullable().default(null),
});

export interface InstalledPackage {
  name: string;
  version?: string;
  composeRef: string;
  dir: string;
  /** Recovered provenance; undefined for plain local compose entries. */
  source?: PackageSource;
  /** The commit a vendored git install was pinned at, for update detection. */
  vendoredCommit?: string;
}

export interface InstallProgress {
  phase: "clone" | "vendor" | "verify";
  /** Only on the "clone" phase. */
  url?: string;
  destinationDir?: string;
}

export interface InstallOptions {
  /** Directory name for git installs; defaults to a slug from the URL. */
  name?: string;
  /** Replace an already-vendored directory. */
  force?: boolean;
  onProgress?: (progress: InstallProgress) => void;
}

export interface InstallResult {
  package: LoadedPackage;
  composeRef: string;
  /** False when the compose entry already existed. */
  addedToCompose: boolean;
  /** Only for git installs. */
  vendoredCommit?: string;
}

export interface UninstallResult {
  composeRef: string;
  dir: string;
  /** True when the vendored directory under `.kata/packages/` was deleted. */
  removedDir: boolean;
}

export interface StagedInstallResult {
  install: InstallResult;
  apply: ApplyResult;
}

export interface StagedUninstallResult {
  uninstall: UninstallResult;
  apply: ApplyResult;
}

/**
 * An uninstall that has been planned but not committed: `plan` shows the
 * native-file changes of removing the package. Nothing changes until
 * `confirm()`; `cancel()` is a no-op kept for flow symmetry.
 */
export interface StagedUninstall {
  composeRef: string;
  dir: string;
  /** True when confirm() will delete a dir vendored under `.kata/packages/`. */
  willRemoveDir: boolean;
  plan: Plan;
  confirm(): Promise<StagedUninstallResult>;
  cancel(): Promise<void>;
}

/**
 * An update that has been fetched and planned but not committed: the new
 * version sits in a temp staging dir, `plan` shows the native-file changes
 * of replacing the vendored copy. `cancel()` leaves the repo byte-identical.
 */
export interface StagedUpdate {
  package: LoadedPackage;
  composeRef: string;
  targetDir: string;
  previousCommit?: string;
  vendoredCommit?: string;
  plan: Plan;
  confirm(): Promise<StagedInstallResult>;
  cancel(): Promise<void>;
}

/**
 * An install that has been fetched and planned but not committed: git
 * sources are vendored into a temp staging dir outside the repo, and `plan`
 * is computed as if the package were already composed. Nothing in the
 * project changes until `confirm()`; `cancel()` leaves the repo
 * byte-identical. The plan reflects the project state at staging time -
 * confirm promptly, or re-stage if the project changed in between.
 */
export interface StagedInstall {
  package: LoadedPackage;
  source: PackageSource;
  /** The compose ref that will be appended on confirm. */
  composeRef: string;
  /** Where the package will be vendored; null when nothing is vendored. */
  targetDir: string | null;
  vendoredCommit?: string;
  plan: Plan;
  confirm(): Promise<StagedInstallResult>;
  cancel(): Promise<void>;
}

/** Append `composeRef` to config.yaml's compose list, preserving comments. */
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

/** Remove `composeRef` from config.yaml's compose list, preserving comments. */
async function removeComposeRef(rootDir: string, composeRef: string): Promise<boolean> {
  const configPath = makeConfigPathFromRoot(rootDir);
  const doc = parseDocument(await readFile(configPath, "utf8"));
  const compose = doc.get("compose", true);
  if (!(compose instanceof YAMLSeq)) return false;
  const index = compose.items.findIndex(
    (item) => String((item as { value?: unknown }).value ?? item) === composeRef,
  );
  if (index === -1) return false;
  compose.items.splice(index, 1);
  await writeFile(configPath, doc.toString(), "utf8");
  return true;
}

async function readVendoredSource(
  dir: string,
): Promise<{ url: string; commit: string | null; subdir: string | null } | null> {
  let raw: string;
  try {
    raw = await readFile(path.join(dir, VENDORED_SOURCE_FILE_NAME), "utf8");
  } catch {
    return null;
  }
  const parsed = vendoredSourceSchema.safeParse(parseYaml(raw) ?? {});
  return parsed.success ? parsed.data : null;
}

async function writeVendoredSource(
  dir: string,
  url: string,
  commit: string | null,
  subdir: string | null,
): Promise<void> {
  const content = stringifyYaml(subdir ? { url, commit, subdir } : { url, commit });
  await writeFile(path.join(dir, VENDORED_SOURCE_FILE_NAME), content, "utf8");
}

export interface EngineOptions {
  scope?: Scope;
  /** Adapters available to plan()/apply(); the caller owns discovery. */
  adapters?: Adapter[];
  /** How git installs clone; defaults to the system git binary. */
  cloneGit?: GitClone;
}

export interface PlanOptions {
  /** Restrict to these target ids; default is every enabled target. */
  targets?: string[];
}

/** Adapters enabled in the project's config, plus target ids nothing handles. */
export function selectEnabledAdapters(
  project: Project,
  adapters: Adapter[],
  only?: string[],
): { adapters: Adapter[]; unknown: string[] } {
  const byId = new Map(adapters.map((adapter) => [adapter.id, adapter]));
  const selected: Adapter[] = [];
  const unknown: string[] = [];
  for (const [id, target] of Object.entries(project.config.targets)) {
    if (!target.enabled) continue;
    if (only && only.length > 0 && !only.includes(id)) continue;
    const adapter = byId.get(id);
    if (adapter) selected.push(adapter);
    else unknown.push(id);
  }
  return { adapters: selected, unknown };
}

export function makeAdapterContext(project: Project, adapter: Adapter): AdapterContext {
  return {
    project,
    projectRoot: project.rootDir,
    homeDir: os.homedir(),
    scope: project.scope,
    targetOptions: project.config.targets[adapter.id]?.options ?? {},
  };
}

export class KataProject {
  readonly rootDir: string;
  readonly scope: Scope;
  private readonly adapters: Adapter[];
  private readonly cloneGit: GitClone;

  constructor(rootDir: string, options: EngineOptions = {}) {
    this.rootDir = rootDir;
    this.scope = options.scope ?? "project";
    this.adapters = options.adapters ?? [];
    this.cloneGit = options.cloneGit ?? systemGitClone;
  }

  /** Parse config.yaml and load every artifact (packages composed in). */
  load(): Promise<Project> {
    return loadProject(this.rootDir, this.scope);
  }

  /** The packages in compose, with provenance where it was recorded. */
  async installedPackages(): Promise<InstalledPackage[]> {
    const project = await this.load();
    const packages: InstalledPackage[] = [];
    for (const pkg of project.packages) {
      const installed: InstalledPackage = {
        name: pkg.manifest.name,
        version: pkg.manifest.version,
        composeRef: pkg.composeRef,
        dir: pkg.dir,
      };
      if (pkg.composeRef.startsWith("npm:")) {
        installed.source = { kind: "npm", packageName: pkg.composeRef.slice("npm:".length) };
      } else {
        const vendored = await readVendoredSource(pkg.dir);
        if (vendored) {
          installed.source = vendored.subdir
            ? { kind: "git", url: vendored.url, subdir: vendored.subdir }
            : { kind: "git", url: vendored.url };
          if (vendored.commit) installed.vendoredCommit = vendored.commit;
        } else {
          installed.source = { kind: "path", path: pkg.composeRef };
        }
      }
      packages.push(installed);
    }
    return packages;
  }

  /** Fetch, vendor, and wire up a package in one step (stage + confirm). */
  async install(source: PackageSource, options: InstallOptions = {}): Promise<InstallResult> {
    const staged = await this.stageInstall(source, options);
    return (await staged.confirm()).install;
  }

  /**
   * Stage an install without touching the project: fetch the package
   * (git sources go to a temp dir), compute the plan as if it were
   * composed, and hand back confirm/cancel. See StagedInstall.
   */
  async stageInstall(source: PackageSource, options: InstallOptions = {}): Promise<StagedInstall> {
    const staged = await this.fetchForStaging(source, options);
    const project = await this.load();
    const plan = await this.planSimulated(project, [...project.packages, staged.package]);

    let settled = false;
    const settle = (action: string): void => {
      if (settled) throw new Error(`This staged install was already ${action}.`);
      settled = true;
    };

    return {
      package: staged.package,
      source: staged.source,
      composeRef: staged.composeRef,
      targetDir: staged.targetDir,
      vendoredCommit: staged.vendoredCommit,
      plan,
      confirm: async (): Promise<StagedInstallResult> => {
        settle("confirmed or cancelled");
        if (staged.stagingRoot && staged.stagingContentDir && staged.targetDir) {
          if (await exists(staged.targetDir)) {
            if (!options.force) {
              await rm(staged.stagingRoot, { recursive: true, force: true });
              const shownDir = displayAbsolutePath(this.rootDir, this.scope, staged.targetDir);
              throw new Error(`${shownDir} already exists (use force to replace it).`);
            }
            await rm(staged.targetDir, { recursive: true, force: true });
          }
          await mkdir(path.dirname(staged.targetDir), { recursive: true });
          await cp(staged.stagingContentDir, staged.targetDir, { recursive: true });
          await rm(staged.stagingRoot, { recursive: true, force: true });
        }
        const addedToCompose = await appendComposeRef(this.rootDir, staged.composeRef);
        const apply = await applyPlan(plan);
        return {
          install: {
            // The staging copy is gone; report the vendored location.
            package: staged.targetDir
              ? { ...staged.package, dir: staged.targetDir }
              : staged.package,
            composeRef: staged.composeRef,
            addedToCompose,
            vendoredCommit: staged.vendoredCommit,
          },
          apply,
        };
      },
      cancel: async (): Promise<void> => {
        settle("cancelled or confirmed");
        if (staged.stagingRoot) {
          await rm(staged.stagingRoot, { recursive: true, force: true });
        }
      },
    };
  }

  /** Fetch a package into staging (or resolve it in place for npm/path). */
  private async fetchForStaging(
    source: PackageSource,
    options: InstallOptions,
  ): Promise<{
    package: LoadedPackage;
    source: PackageSource;
    composeRef: string;
    targetDir: string | null;
    /** The temp clone to discard; null when nothing was fetched. */
    stagingRoot: string | null;
    /** The bundle content inside the clone (the subdir for monorepos). */
    stagingContentDir: string | null;
    vendoredCommit?: string;
  }> {
    if (source.kind === "npm") {
      const composeRef = `npm:${source.packageName}`;
      const pkg = await loadPackage(composeRef, this.rootDir);
      return {
        package: pkg,
        source,
        composeRef,
        targetDir: null,
        stagingRoot: null,
        stagingContentDir: null,
      };
    }

    if (source.kind === "path") {
      const absoluteDir = path.resolve(this.rootDir, source.path);
      const composeRef = makeLocalComposeRef(this.rootDir, absoluteDir);
      const pkg = await loadPackage(composeRef, this.rootDir);
      return {
        package: pkg,
        source,
        composeRef,
        targetDir: null,
        stagingRoot: null,
        stagingContentDir: null,
      };
    }

    const subdir = source.subdir ?? null;
    const slug =
      options.name ?? (subdir ? path.posix.basename(subdir) : slugFromGitUrl(source.url));
    const targetDir = path.join(makeConfigDirPath(this.rootDir), PACKAGES_DIR_NAME, slug);
    if (!options.force && (await exists(targetDir))) {
      const shownDir = displayAbsolutePath(this.rootDir, this.scope, targetDir);
      throw new Error(`${shownDir} already exists (use force to replace it).`);
    }

    const stagingRoot = await mkdtemp(path.join(os.tmpdir(), "kata-stage-"));
    try {
      options.onProgress?.({ phase: "clone", url: source.url, destinationDir: targetDir });
      const { commit } = await this.cloneGit(source.url, stagingRoot);
      options.onProgress?.({ phase: "vendor", destinationDir: targetDir });
      await rm(path.join(stagingRoot, ".git"), { recursive: true, force: true });
      options.onProgress?.({ phase: "verify", destinationDir: targetDir });
      const contentDir = subdir ? path.join(stagingRoot, subdir) : stagingRoot;
      if (!(await exists(path.join(contentDir, PACKAGE_MANIFEST_NAME)))) {
        const where = subdir ? `${source.url} at ${subdir}` : source.url;
        throw new Error(
          `${where} is not an kata package (no ${PACKAGE_MANIFEST_NAME} at its root).`,
        );
      }
      await writeVendoredSource(contentDir, source.url, commit, subdir);
      const pkg = await loadPackage(contentDir, this.rootDir);
      return {
        // The staged dir is temporary; report the ref confirm() will write.
        package: { ...pkg, composeRef: makeLocalComposeRef(this.rootDir, targetDir) },
        source,
        composeRef: makeLocalComposeRef(this.rootDir, targetDir),
        targetDir,
        stagingRoot,
        stagingContentDir: contentDir,
        vendoredCommit: commit ?? undefined,
      };
    } catch (err) {
      await rm(stagingRoot, { recursive: true, force: true });
      throw err;
    }
  }

  /** The plan as it would be with exactly `packages` composed, in order. */
  private async planSimulated(project: Project, packages: LoadedPackage[]): Promise<Plan> {
    let artifacts = emptyArtifacts();
    for (const pkg of packages) {
      artifacts = mergeArtifacts(artifacts, pkg.artifacts);
    }
    // Local project artifacts still override every package.
    artifacts = mergeArtifacts(artifacts, await loadArtifactsFromDir(project.configDir));
    const simulated: Project = { ...project, ...artifacts, packages };
    const { adapters } = selectEnabledAdapters(simulated, this.adapters);
    return planAll(adapters, (adapter) => makeAdapterContext(simulated, adapter));
  }

  /**
   * Stage an uninstall: the plan shows what removing the package changes.
   * Nothing happens until confirm().
   */
  async stageUninstall(name: string): Promise<StagedUninstall> {
    const project = await this.load();
    const target = project.packages.find((pkg) => pkg.manifest.name === name);
    if (!target) {
      const known = project.packages.map((pkg) => pkg.manifest.name).join(", ") || "none";
      throw new Error(`No installed package named "${name}" (installed: ${known}).`);
    }
    const remaining = project.packages.filter((pkg) => pkg !== target);
    const plan = await this.planSimulated(project, remaining);
    const vendoredParent = path.join(makeConfigDirPath(this.rootDir), PACKAGES_DIR_NAME);
    const willRemoveDir = path.dirname(target.dir) === vendoredParent;

    let settled = false;
    const settle = (): void => {
      if (settled) throw new Error("This staged uninstall was already settled.");
      settled = true;
    };

    return {
      composeRef: target.composeRef,
      dir: target.dir,
      willRemoveDir,
      plan,
      confirm: async (): Promise<StagedUninstallResult> => {
        settle();
        await removeComposeRef(this.rootDir, target.composeRef);
        if (willRemoveDir) {
          await rm(target.dir, { recursive: true, force: true });
        }
        const apply = await applyPlan(plan);
        return {
          uninstall: { composeRef: target.composeRef, dir: target.dir, removedDir: willRemoveDir },
          apply,
        };
      },
      cancel: async (): Promise<void> => {
        settle();
      },
    };
  }

  /**
   * Stage an update: re-fetch a vendored git package into staging and plan
   * the replacement. Only git-sourced packages are updatable; the compose
   * ref and vendored directory stay the same.
   */
  async stageUpdate(name: string): Promise<StagedUpdate> {
    const project = await this.load();
    const target = project.packages.find((pkg) => pkg.manifest.name === name);
    if (!target) {
      const known = project.packages.map((pkg) => pkg.manifest.name).join(", ") || "none";
      throw new Error(`No installed package named "${name}" (installed: ${known}).`);
    }
    const vendored = await readVendoredSource(target.dir);
    if (!vendored) {
      throw new Error(
        `"${name}" was not installed from git (no recorded source), so kata cannot update it. Local-path and npm packages update at their source.`,
      );
    }

    const stagingRoot = await mkdtemp(path.join(os.tmpdir(), "kata-stage-"));
    let staged: LoadedPackage;
    let stagingContentDir: string;
    let commit: string | null;
    try {
      ({ commit } = await this.cloneGit(vendored.url, stagingRoot));
      await rm(path.join(stagingRoot, ".git"), { recursive: true, force: true });
      stagingContentDir = vendored.subdir ? path.join(stagingRoot, vendored.subdir) : stagingRoot;
      if (!(await exists(path.join(stagingContentDir, PACKAGE_MANIFEST_NAME)))) {
        const where = vendored.subdir ? `${vendored.url} at ${vendored.subdir}` : vendored.url;
        throw new Error(
          `${where} is not an kata package (no ${PACKAGE_MANIFEST_NAME} at its root).`,
        );
      }
      await writeVendoredSource(stagingContentDir, vendored.url, commit, vendored.subdir);
      const loaded = await loadPackage(stagingContentDir, this.rootDir);
      staged = { ...loaded, composeRef: target.composeRef };
    } catch (err) {
      await rm(stagingRoot, { recursive: true, force: true });
      throw err;
    }

    const replaced = project.packages.map((pkg) => (pkg === target ? staged : pkg));
    const plan = await this.planSimulated(project, replaced);

    let settled = false;
    const settle = (): void => {
      if (settled) throw new Error("This staged update was already settled.");
      settled = true;
    };

    return {
      package: staged,
      composeRef: target.composeRef,
      targetDir: target.dir,
      previousCommit: vendored.commit ?? undefined,
      vendoredCommit: commit ?? undefined,
      plan,
      confirm: async (): Promise<StagedInstallResult> => {
        settle();
        await rm(target.dir, { recursive: true, force: true });
        await mkdir(path.dirname(target.dir), { recursive: true });
        await cp(stagingContentDir, target.dir, { recursive: true });
        await rm(stagingRoot, { recursive: true, force: true });
        const apply = await applyPlan(plan);
        return {
          install: {
            package: staged,
            composeRef: target.composeRef,
            addedToCompose: false,
            vendoredCommit: commit ?? undefined,
          },
          apply,
        };
      },
      cancel: async (): Promise<void> => {
        settle();
        await rm(stagingRoot, { recursive: true, force: true });
      },
    };
  }

  /** Remove a package (by manifest name) from compose; delete it if vendored. */
  async uninstall(name: string): Promise<UninstallResult> {
    const packages = await this.installedPackages();
    const pkg = packages.find((candidate) => candidate.name === name);
    if (!pkg) {
      const known = packages.map((candidate) => candidate.name).join(", ") || "none";
      throw new Error(`No installed package named "${name}" (installed: ${known}).`);
    }
    await removeComposeRef(this.rootDir, pkg.composeRef);
    const vendoredParent = path.join(makeConfigDirPath(this.rootDir), PACKAGES_DIR_NAME);
    const removedDir = path.dirname(pkg.dir) === vendoredParent;
    if (removedDir) {
      await rm(pkg.dir, { recursive: true, force: true });
    }
    return { composeRef: pkg.composeRef, dir: pkg.dir, removedDir };
  }

  async plan(options: PlanOptions = {}): Promise<Plan> {
    const project = await this.load();
    const { adapters } = selectEnabledAdapters(project, this.adapters, options.targets);
    return planAll(adapters, (adapter) => makeAdapterContext(project, adapter));
  }

  apply(plan: Plan): Promise<ApplyResult> {
    return applyPlan(plan);
  }
}

/** Open an existing kata project (its `.kata/config.yaml` must exist). */
export async function openProject(
  rootDir: string,
  options: EngineOptions = {},
): Promise<KataProject> {
  const configPath = makeConfigPathFromRoot(rootDir);
  if (!(await exists(configPath))) {
    throw new Error(`No .kata/config.yaml found in ${rootDir}. Run \`kata init\` first.`);
  }
  return new KataProject(rootDir, options);
}

/**
 * Create a minimal `.kata/` (config.yaml with every adapter listed, enabled
 * when detected) and open it. No-op if the project already exists. Callers
 * wanting sample content (the CLI's `kata init`) write it on top.
 */
export async function initProject(
  rootDir: string,
  options: EngineOptions = {},
): Promise<KataProject> {
  const configPath = makeConfigPathFromRoot(rootDir);
  if (await exists(configPath)) {
    return new KataProject(rootDir, options);
  }
  const scope = options.scope ?? "project";
  const targetLines: string[] = [];
  for (const adapter of options.adapters ?? []) {
    const detected = await adapter.detect(makeStandaloneContext(rootDir, scope));
    targetLines.push(`  ${adapter.id}:`, `    enabled: ${detected}`);
  }
  const configYaml = [`version: ${CONFIG_SCHEMA_VERSION}`, "targets:", ...targetLines, ""].join(
    "\n",
  );
  await mkdir(makeConfigDirPath(rootDir), { recursive: true });
  await writeFile(configPath, configYaml, "utf8");
  return new KataProject(rootDir, options);
}

/**
 * An AdapterContext over an empty project, for running `detect()` before
 * any config exists (init-time tool detection).
 */
export function makeStandaloneContext(rootDir: string, scope: Scope): AdapterContext {
  return {
    project: {
      rootDir,
      configDir: makeConfigDirPath(rootDir),
      config: { version: CONFIG_SCHEMA_VERSION, targets: {}, compose: [] },
      packages: [],
      scope,
      instructions: [],
      mcpServers: {},
      prompts: [],
      agents: [],
      skills: [],
    },
    projectRoot: rootDir,
    homeDir: os.homedir(),
    scope,
    targetOptions: {},
  };
}
