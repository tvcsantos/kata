import { isUtf8 } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Adapter, AdapterContext, AdapterWarning, Scope } from "./adapter.js";
import { toPosixPath } from "./fs.js";
import { resolveContent } from "./strategies.js";

export type PlanAction = "create" | "update" | "unchanged";

export interface PlannedFile {
  /** Relative to the project root, or to the home dir when scope is "global". */
  relativePath: string;
  /** Where the file is written or read from. */
  scope: Scope;
  absolutePath: string;
  action: PlanAction;
  /** A Buffer when the existing file is not valid UTF-8. */
  oldContent: string | Buffer | null;
  /** A Buffer for binary assets ("replace" strategy only). */
  newContent: string | Buffer;
}

/** Human-readable path: global files render as `~/...`. */
export function displayPath(relativePath: string, scope: Scope): string {
  return scope === "global" ? `~/${relativePath}` : relativePath;
}

/**
 * Human-readable form of an absolute path, derived from where it lives:
 * relative to `rootDir`, `/`-separated, `~/`-prefixed for the global scope.
 */
export function displayAbsolutePath(rootDir: string, scope: Scope, absolutePath: string): string {
  return displayPath(toPosixPath(path.relative(rootDir, absolutePath)), scope);
}

export interface TargetPlan {
  target: string;
  detected: boolean;
  files: PlannedFile[];
  warnings: AdapterWarning[];
}

export interface Plan {
  targets: TargetPlan[];
}

export function planHasChanges(plan: Plan): boolean {
  return plan.targets.some((target) => target.files.some((file) => file.action !== "unchanged"));
}

function contentEquals(a: string | Buffer, b: string | Buffer): boolean {
  const bufferA = typeof a === "string" ? Buffer.from(a, "utf8") : a;
  const bufferB = typeof b === "string" ? Buffer.from(b, "utf8") : b;
  return bufferA.equals(bufferB);
}

function getPlanAction(
  oldContent: string | Buffer | null,
  newContent: string | Buffer,
): PlanAction {
  if (oldContent === null) return "create";
  if (contentEquals(oldContent, newContent)) return "unchanged";
  return "update";
}

export async function planTarget(adapter: Adapter, context: AdapterContext): Promise<TargetPlan> {
  const { files, warnings } = await adapter.emit(context);
  const planned: PlannedFile[] = [];
  for (const file of files) {
    const scope: Scope = file.scope ?? "project";
    const baseDir = scope === "global" ? context.homeDir : context.projectRoot;
    const absolutePath = path.resolve(baseDir, file.relativePath);
    let oldBytes: Buffer | null;
    try {
      oldBytes = await readFile(absolutePath);
    } catch {
      oldBytes = null;
    }
    const oldContent =
      oldBytes === null ? null : isUtf8(oldBytes) ? oldBytes.toString("utf8") : oldBytes;
    const newContent = resolveContent(file, oldContent);
    const action: PlanAction = getPlanAction(oldContent, newContent);
    planned.push({
      relativePath: file.relativePath,
      scope,
      absolutePath,
      action,
      oldContent,
      newContent,
    });
  }
  return {
    target: adapter.id,
    detected: await adapter.detect(context),
    files: planned,
    warnings,
  };
}

export async function planAll(
  adapters: Adapter[],
  makeContext: (adapter: Adapter) => AdapterContext,
): Promise<Plan> {
  const targets: TargetPlan[] = [];
  for (const adapter of adapters) {
    targets.push(await planTarget(adapter, makeContext(adapter)));
  }
  return { targets };
}
