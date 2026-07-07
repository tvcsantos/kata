import { isUtf8 } from "node:buffer";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { Scope } from "./adapter.js";
import { exists, listFilesRecursive, readNamedMarkdownFiles, toPosixPath } from "./fs.js";
import {
  configSchema,
  mcpServersFileSchema,
  packageManifestSchema,
  type KataConfig,
  type McpServer,
  type McpServersFile,
  type PackageManifest,
} from "./schema.js";

export const CONFIG_DIR_NAME = ".kata";
export const CONFIG_FILE_NAME = "config.yaml";
export const PACKAGE_MANIFEST_NAME = "kata-package.yaml";
/** Where `kata install` vendors git packages, relative to the config dir. */
export const PACKAGES_DIR_NAME = "packages";
export const SKILL_MD_NAME = "SKILL.md";

/** Validate `data` against `schema`; throws a prettified error on failure.
 * Callers add file context by wrapping. */
function parseWith<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(z.prettifyError(result.error));
  }
  return result.data;
}

export interface InstructionFile {
  /** File name without extension, e.g. "base". */
  name: string;
  content: string;
}

/** A reusable prompt / slash command. Content keeps its frontmatter verbatim. */
export interface PromptFile {
  name: string;
  content: string;
}

/** A subagent definition (markdown with frontmatter). */
export interface SubagentFile {
  name: string;
  content: string;
}

export interface SkillFile {
  /** Path relative to the skill directory, e.g. "SKILL.md" or "scripts/run.sh". */
  relativePath: string;
  /** UTF-8 text as a string; binary assets as a Buffer, copied byte-for-byte. */
  content: string | Buffer;
}

/** A skill directory (SKILL.md plus supporting text files). */
export interface Skill {
  name: string;
  files: SkillFile[];
}

/** The artifact payload of a project or shared package. */
export interface ProjectArtifacts {
  instructions: InstructionFile[];
  mcpServers: Record<string, McpServer>;
  prompts: PromptFile[];
  agents: SubagentFile[];
  skills: Skill[];
}

export interface LoadedPackage {
  manifest: PackageManifest;
  /** The compose ref this package was resolved from. */
  composeRef: string;
  dir: string;
  artifacts: ProjectArtifacts;
}

export interface Project extends ProjectArtifacts {
  /** Directory that contains `.kata/` - native files are emitted relative to it. */
  rootDir: string;
  configDir: string;
  config: KataConfig;
  /** Composed packages, in application order (before local overrides). */
  packages: LoadedPackage[];
  /**
   * "project" for a repo-level `.kata/`; "global" when this is the
   * user-level `~/.kata/` (adapters then emit each tool's home-dir files).
   */
  scope: Scope;
}

export function makeInstructionsDirPath(dir: string): string {
  return path.join(dir, "instructions");
}

export function makeInstructionRelativePath(name: string): string {
  return path.posix.join("instructions", `${name}.md`);
}

export function makeInstructionPath(dir: string, name: string): string {
  return path.join(dir, makeInstructionRelativePath(name));
}

export function makePromptsDirPath(dir: string): string {
  return path.join(dir, "prompts");
}

export function makePromptRelativePath(name: string): string {
  return path.posix.join("prompts", `${name}.md`);
}

export function makePromptPath(dir: string, name: string): string {
  return path.join(dir, makePromptRelativePath(name));
}

export function makeAgentsDirPath(dir: string): string {
  return path.join(dir, "agents");
}

export function makeAgentRelativePath(name: string): string {
  return path.posix.join("agents", `${name}.md`);
}

export function makeAgentPath(dir: string, name: string): string {
  return path.join(dir, makeAgentRelativePath(name));
}

export function makeSkillsDirPath(dir: string): string {
  return path.join(dir, "skills");
}

export function makeSkillDirRelativePath(name: string): string {
  return path.posix.join("skills", name);
}

export function makeSkillDirPath(dir: string, name: string): string {
  return path.join(dir, makeSkillDirRelativePath(name));
}

export function makeSkillRelativePath(name: string): string {
  return path.posix.join(makeSkillDirRelativePath(name), SKILL_MD_NAME);
}

export function makeSkillPath(dir: string, name: string): string {
  return path.join(dir, makeSkillRelativePath(name));
}

export function makeMcpDirPath(dir: string): string {
  return path.join(dir, "mcp");
}

function makeMcpServersRelativePath(): string {
  return path.posix.join("mcp", "servers.yaml");
}

export function makeMcpServerPath(dir: string): string {
  return path.join(dir, makeMcpServersRelativePath());
}

export function getRootDir(scope: Scope): string {
  return scope === "global" ? os.homedir() : process.cwd();
}

export function makeConfigDirPath(dir: string): string {
  return path.join(dir, CONFIG_DIR_NAME);
}

export function makeConfigPathFromRoot(dir: string): string {
  return path.join(dir, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
}

export function makeConfigPath(configDir: string): string {
  return path.join(configDir, CONFIG_FILE_NAME);
}

/**
 * Walk up from `startDir` to find the nearest directory containing `.kata/`.
 * Directories in `skipDirs` (e.g. the home dir, whose `.kata/` is the global
 * config) are never treated as a project root.
 */
export async function findProjectRoot(
  startDir: string,
  skipDirs: string[] = [],
): Promise<string | null> {
  const skip = new Set(skipDirs.map((dir) => path.resolve(dir)));
  let dir = path.resolve(startDir);

  while (true) {
    if (!skip.has(dir) && (await exists(makeConfigPathFromRoot(dir)))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Read every skill directory under `dir`. Text assets load as UTF-8 strings;
 * anything that isn't valid UTF-8 loads as a Buffer and is copied
 * byte-for-byte on emit.
 *
 * A directory without a SKILL.md is skipped by default - the right behavior
 * when importing from a tool's directory, where unrelated folders may sit
 * next to real skills. In a kata layout (`.kata/` or a shared package)
 * it's a config mistake instead: pass `requiresSkillMd = true` to fail.
 * Errors name paths relative to `dir`'s parent (`skills/<name>/SKILL.md`);
 * callers that know the user-facing location add it by wrapping.
 */
export async function readSkillDirs(dir: string, requiresSkillMd = false): Promise<Skill[]> {
  if (!(await exists(dir))) return [];
  const skills: Skill[] = [];
  const entries = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of entries) {
    const skillDir = path.join(dir, name);
    const files: SkillFile[] = [];
    for (const relativePath of await listFilesRecursive(skillDir)) {
      const bytes = await readFile(path.join(skillDir, relativePath));
      files.push({
        relativePath,
        content: isUtf8(bytes) ? bytes.toString("utf8") : bytes,
      });
    }
    if (!files.some((file) => file.relativePath === SKILL_MD_NAME)) {
      if (requiresSkillMd) {
        throw new Error(
          `Skill "${name}" is missing its ${SKILL_MD_NAME} (${makeSkillRelativePath(name)})`,
        );
      }
      continue;
    }
    skills.push({ name, files });
  }
  return skills;
}

/**
 * Load the artifact payload from a directory laid out like `.kata/`
 * (also the layout of shared packages).
 *
 * Errors name files relative to `dir` (e.g. `mcp/servers.yaml`); callers
 * that know the user-facing location (compose ref, `.kata`) add it by
 * wrapping the error.
 */
export async function loadArtifactsFromDir(dir: string): Promise<ProjectArtifacts> {
  let mcpServers: Record<string, McpServer> = {};
  const serversPath = makeMcpServerPath(dir);
  if (await exists(serversPath)) {
    const raw = await readFile(serversPath, "utf8");
    let parsed: McpServersFile;
    try {
      parsed = parseWith(mcpServersFileSchema, parseYaml(raw) ?? {});
    } catch (err) {
      throw new Error(
        `Invalid ${toPosixPath(path.relative(dir, serversPath))}:\n${(err as Error).message}`,
        { cause: err },
      );
    }
    mcpServers = Object.fromEntries(
      Object.entries(parsed.servers).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  return {
    instructions: await readNamedMarkdownFiles(makeInstructionsDirPath(dir)),
    mcpServers,
    prompts: await readNamedMarkdownFiles(makePromptsDirPath(dir)),
    agents: await readNamedMarkdownFiles(makeAgentsDirPath(dir)),
    skills: await readSkillDirs(makeSkillsDirPath(dir), true),
  };
}

function overrideByName<T extends { name: string }>(base: T[], overlay: T[]): T[] {
  const merged = new Map(base.map((item) => [item.name, item]));
  for (const item of overlay) merged.set(item.name, item);
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Overlay wins on name collisions; results stay sorted for determinism. */
export function mergeArtifacts(
  base: ProjectArtifacts,
  overlay: ProjectArtifacts,
): ProjectArtifacts {
  return {
    instructions: overrideByName(base.instructions, overlay.instructions),
    mcpServers: Object.fromEntries(
      Object.entries({ ...base.mcpServers, ...overlay.mcpServers }).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    ),
    prompts: overrideByName(base.prompts, overlay.prompts),
    agents: overrideByName(base.agents, overlay.agents),
    skills: overrideByName(base.skills, overlay.skills),
  };
}

export function emptyArtifacts(): ProjectArtifacts {
  return { instructions: [], mcpServers: {}, prompts: [], agents: [], skills: [] };
}

export function makeNodeModulesDirPath(rootDir: string): string {
  return path.join(rootDir, "node_modules");
}

/** Find `node_modules/<name>` walking up from `startDir`. */
async function resolveNpmPackageDir(name: string, startDir: string): Promise<string | null> {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(makeNodeModulesDirPath(dir), name);
    if (await exists(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function isCurrentDirRelative(composeRef: string): boolean {
  return composeRef.startsWith("./");
}

function isParentDirRelative(composeRef: string): boolean {
  return composeRef.startsWith("../");
}

/**
 * The `./`-style compose ref for a package directory inside the project -
 * the inverse of `resolvePackageDir` for local paths.
 */
export function makeLocalComposeRef(rootDir: string, packageDir: string): string {
  return `./${toPosixPath(path.relative(rootDir, packageDir))}`;
}

export async function resolvePackageDir(composeRef: string, rootDir: string): Promise<string> {
  if (composeRef.startsWith("npm:")) {
    const name = composeRef.slice("npm:".length);
    const dir = await resolveNpmPackageDir(name, rootDir);
    if (!dir) {
      throw new Error(
        `Compose ref "${composeRef}": package "${name}" not found in node_modules. Install it with your package manager first.`,
      );
    }
    return dir;
  }
  if (
    isCurrentDirRelative(composeRef) ||
    isParentDirRelative(composeRef) ||
    path.isAbsolute(composeRef)
  ) {
    return path.resolve(rootDir, composeRef);
  }
  throw new Error(
    `Compose ref "${composeRef}" is not supported. Use "./local/path", "npm:<package>", or \`kata install <git-url>\`.`,
  );
}

export async function loadPackage(composeRef: string, rootDir: string): Promise<LoadedPackage> {
  const dir = await resolvePackageDir(composeRef, rootDir);
  const manifestPath = path.join(dir, PACKAGE_MANIFEST_NAME);
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    throw new Error(`Compose ref "${composeRef}": no ${PACKAGE_MANIFEST_NAME} found in ${dir}`);
  }
  let manifest: PackageManifest;
  try {
    manifest = parseWith(packageManifestSchema, parseYaml(raw) ?? {});
  } catch (err) {
    throw new Error(
      `Compose ref "${composeRef}": invalid ${PACKAGE_MANIFEST_NAME}:\n${(err as Error).message}`,
      { cause: err },
    );
  }
  let artifacts: ProjectArtifacts;
  try {
    artifacts = await loadArtifactsFromDir(dir);
  } catch (err) {
    throw new Error(`Compose ref "${composeRef}": ${(err as Error).message}`, { cause: err });
  }
  return { manifest, composeRef, dir, artifacts };
}

export async function loadProject(rootDir: string, scope: Scope = "project"): Promise<Project> {
  const configDir = makeConfigDirPath(rootDir);
  const configPath = makeConfigPath(configDir);
  const shownConfigPath = toPosixPath(path.relative(rootDir, configPath));
  let rawConfig: string;
  try {
    rawConfig = await readFile(configPath, "utf8");
  } catch {
    throw new Error(`No ${shownConfigPath} found in ${rootDir}. Run \`kata init\` first.`);
  }
  let config: KataConfig;
  try {
    config = parseWith(configSchema, parseYaml(rawConfig) ?? {});
  } catch (err) {
    throw new Error(`Invalid ${shownConfigPath}:\n${(err as Error).message}`, { cause: err });
  }

  const packages: LoadedPackage[] = [];
  let artifacts = emptyArtifacts();
  for (const composeRef of config.compose) {
    const pkg = await loadPackage(composeRef, rootDir);
    packages.push(pkg);
    artifacts = mergeArtifacts(artifacts, pkg.artifacts);
  }

  // Local project artifacts override every composed package.
  let local: ProjectArtifacts;
  try {
    local = await loadArtifactsFromDir(configDir);
  } catch (err) {
    throw new Error(`${CONFIG_DIR_NAME}: ${(err as Error).message}`, { cause: err });
  }
  artifacts = mergeArtifacts(artifacts, local);

  return { rootDir, configDir, config, packages, scope, ...artifacts };
}
