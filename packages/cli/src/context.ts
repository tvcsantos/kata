import type { Dirent } from "node:fs";
import { readdir, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pc from "picocolors";
import {
  AdapterRegistry,
  displayAbsolutePath,
  findProjectRoot,
  loadProject,
  makeAdapterContext,
  makeConfigPathFromRoot,
  makeNodeModulesDirPath,
  selectEnabledAdapters,
  type Adapter,
  type AdapterContext,
  type Project,
} from "@katahq/core";
import claudeCodeAdapter from "@katahq/adapter-claude-code";
import codexAdapter from "@katahq/adapter-codex";
import copilotAdapter from "@katahq/adapter-copilot";
import cursorAdapter from "@katahq/adapter-cursor";
import geminiAdapter from "@katahq/adapter-gemini";
import opencodeAdapter from "@katahq/adapter-opencode";
import vscodeAdapter from "@katahq/adapter-vscode";

export function builtinRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();
  registry.register(claudeCodeAdapter);
  registry.register(codexAdapter);
  registry.register(copilotAdapter);
  registry.register(cursorAdapter);
  registry.register(geminiAdapter);
  registry.register(opencodeAdapter);
  registry.register(vscodeAdapter);
  return registry;
}

const PLUGIN_PREFIX = "kata-adapter-";

function looksLikeAdapter(value: unknown): value is Adapter {
  if (typeof value !== "object" || value === null) return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a.id === "string" &&
    typeof a.displayName === "string" &&
    typeof a.capabilities === "object" &&
    typeof a.detect === "function" &&
    typeof a.emit === "function"
  );
}

/** List installed plugin package dirs (`kata-adapter-*`), walking node_modules up from startDir. */
async function findPluginDirs(startDir: string): Promise<string[]> {
  const dirs: string[] = [];
  const seen = new Set<string>();
  let dir = path.resolve(startDir);
  for (;;) {
    const nodeModulesDir = makeNodeModulesDirPath(dir);
    let entries: Dirent[];
    try {
      entries = await readdir(nodeModulesDir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name.startsWith(PLUGIN_PREFIX)) {
        if (!seen.has(entry.name)) {
          seen.add(entry.name);
          dirs.push(path.join(nodeModulesDir, entry.name));
        }
      } else if (entry.name.startsWith("@")) {
        let scoped: string[];
        try {
          scoped = await readdir(path.join(nodeModulesDir, entry.name));
        } catch {
          scoped = [];
        }
        for (const inner of scoped) {
          const full = `${entry.name}/${inner}`;
          if (inner.startsWith(PLUGIN_PREFIX) && !seen.has(full)) {
            seen.add(full);
            dirs.push(path.join(nodeModulesDir, entry.name, inner));
          }
        }
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return dirs;
    dir = parent;
  }
}

async function loadPluginAdapter(pkgDir: string): Promise<Adapter | null> {
  const pkgJson = JSON.parse(await readFile(path.join(pkgDir, "package.json"), "utf8")) as {
    name?: string;
    main?: string;
  };
  const entry = path.resolve(pkgDir, pkgJson.main ?? "index.js");
  const mod = (await import(pathToFileURL(entry).href)) as { default?: unknown };
  return looksLikeAdapter(mod.default) ? mod.default : null;
}

/** Builtins plus any `kata-adapter-*` plugins installed near `startDir`. */
export async function buildRegistry(startDir = process.cwd()): Promise<AdapterRegistry> {
  const registry = builtinRegistry();
  for (const pkgDir of await findPluginDirs(startDir)) {
    const label = path.basename(pkgDir);
    try {
      const adapter = await loadPluginAdapter(pkgDir);
      if (!adapter) {
        console.error(
          pc.yellow(`warning: ${label} does not default-export a valid adapter, skipped`),
        );
        continue;
      }
      if (registry.get(adapter.id)) {
        console.error(pc.yellow(`warning: ${label} redefines adapter "${adapter.id}", skipped`));
        continue;
      }
      registry.register(adapter);
    } catch (err) {
      console.error(
        pc.yellow(`warning: failed to load adapter plugin ${label}: ${(err as Error).message}`),
      );
    }
  }
  return registry;
}

/**
 * Load the kata config: the nearest project `.kata/` when `global` is
 * false, or the user-level `~/.kata/` when true. The home directory itself is
 * reserved for global scope and never picked up as a project root.
 */
export async function loadProjectFromCwd(global = false): Promise<Project> {
  const home = os.homedir();
  if (global) {
    const configPath = makeConfigPathFromRoot(home);
    try {
      await readFile(configPath, "utf8");
    } catch {
      throw new Error(
        `No ${displayAbsolutePath(home, "global", configPath)} found. Run \`kata init --global\` first.`,
      );
    }
    return loadProject(home, "global");
  }
  // process.cwd() is fully resolved, so also skip the home dir's real path
  // in case it contains symlinks (e.g. macOS /var -> /private/var).
  let homeReal: string;
  try {
    homeReal = await realpath(home);
  } catch {
    homeReal = home;
  }
  const root = await findProjectRoot(process.cwd(), [home, homeReal]);
  if (!root) {
    throw new Error(
      "No .kata/config.yaml found in this directory or any parent. Run `kata init` first (or use --global for the user-level config).",
    );
  }
  return loadProject(root);
}

export interface EnabledTargets {
  adapters: Adapter[];
  /** Target ids in config.yaml with no registered adapter. */
  unknown: string[];
}

export function enabledAdapters(
  project: Project,
  registry: AdapterRegistry,
  only?: string[],
): EnabledTargets {
  return selectEnabledAdapters(project, registry.all(), only);
}

export function makeContext(project: Project, adapter: Adapter): AdapterContext {
  return makeAdapterContext(project, adapter);
}
