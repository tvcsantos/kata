import { structuredPatch } from "diff";
import type { Scope } from "./adapter.js";
import type { Plan, PlanAction, PlannedFile } from "./plan.js";
import { removeManagedRegion } from "./strategies.js";

/**
 * Structured views of a plan, for programmatic consumers (the desktop app,
 * `--json` CLI output). The CLI's human rendering stays string-based; these
 * carry the same facts as data.
 */

export interface PlanSummary {
  creates: number;
  updates: number;
  unchanged: number;
}

export function summarizePlan(plan: Plan): PlanSummary {
  const summary: PlanSummary = { creates: 0, updates: 0, unchanged: 0 };
  for (const target of plan.targets) {
    for (const file of target.files) {
      if (file.action === "create") summary.creates += 1;
      else if (file.action === "update") summary.updates += 1;
      else summary.unchanged += 1;
    }
  }
  return summary;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Unified-diff lines, each prefixed with " ", "+", or "-". */
  lines: string[];
}

export interface FileDiff {
  /** Relative to the project root, or to the home dir when scope is "global". */
  relativePath: string;
  scope: Scope;
  action: PlanAction;
  /** True when either side is binary; hunks are empty then. */
  binary: boolean;
  /**
   * True when the change stays inside the kata-managed region (or, for
   * creates, the whole file is the managed region) - the trust signal UIs
   * show to mean "your hand edits are untouched".
   */
  managedRegionOnly: boolean;
  hunks: DiffHunk[];
}

function isManagedRegionOnly(oldContent: string | null, newContent: string): boolean {
  const oldOutside = removeManagedRegion(oldContent ?? "");
  const newOutside = removeManagedRegion(newContent);
  if (newOutside === newContent) return false; // no managed region at all
  return oldOutside === newOutside;
}

/** The structured diff for one planned file. Unchanged files get no hunks. */
export function computeFileDiff(file: PlannedFile): FileDiff {
  const base = {
    relativePath: file.relativePath,
    scope: file.scope,
    action: file.action,
  };
  if (Buffer.isBuffer(file.oldContent) || Buffer.isBuffer(file.newContent)) {
    return { ...base, binary: true, managedRegionOnly: false, hunks: [] };
  }
  const managedRegionOnly = isManagedRegionOnly(file.oldContent, file.newContent);
  if (file.action === "unchanged") {
    return { ...base, binary: false, managedRegionOnly, hunks: [] };
  }
  const patch = structuredPatch(
    file.relativePath,
    file.relativePath,
    file.oldContent ?? "",
    file.newContent,
    undefined,
    undefined,
    { context: 3 },
  );
  const hunks = patch.hunks.map((hunk) => ({
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    lines: hunk.lines,
  }));
  return { ...base, binary: false, managedRegionOnly, hunks };
}
