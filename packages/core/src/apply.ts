import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plan, PlannedFile } from "./plan.js";

export interface ApplyResult {
  written: PlannedFile[];
  skipped: PlannedFile[];
}

/** Write every planned create/update to disk. Unchanged files are left alone. */
export async function applyPlan(plan: Plan): Promise<ApplyResult> {
  const written: PlannedFile[] = [];
  const skipped: PlannedFile[] = [];
  for (const target of plan.targets) {
    for (const file of target.files) {
      if (file.action === "unchanged") {
        skipped.push(file);
        continue;
      }
      await mkdir(path.dirname(file.absolutePath), { recursive: true });
      await writeFile(file.absolutePath, file.newContent, "utf8");
      written.push(file);
    }
  }
  return { written, skipped };
}
