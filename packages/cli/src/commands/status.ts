import { Flags } from "@oclif/core";
import pc from "picocolors";
import { displayPath } from "@katahq/core";
import { computePlan } from "./plan.js";
import { KATA_APPLY_HINT, KATA_IMPORT_HINT, KATA_PLAN_HINT } from "../hints.js";
import { KataCommand } from "../kata-command.js";

/**
 * Drift detection: report native files that differ from what the kata
 * config would render. Exits non-zero when anything is out of sync, so it can
 * gate CI.
 */
export async function runStatus(opts: { target?: string[]; global?: boolean }): Promise<void> {
  const plan = await computePlan(opts.target, opts.global ?? false);
  let outOfSync = 0;
  for (const target of plan.targets) {
    const lines: string[] = [];
    for (const file of target.files) {
      if (file.action === "unchanged") continue;
      outOfSync += 1;
      const label = file.action === "create" ? pc.red("missing ") : pc.yellow("drifted ");
      lines.push(`  ${label} ${displayPath(file.relativePath, file.scope)}`);
    }
    if (lines.length > 0) {
      console.log(pc.bold(`target ${target.target}`));
      for (const line of lines) console.log(line);
    }
  }
  if (outOfSync === 0) {
    console.log(pc.green("In sync. All native configs match the kata config."));
    return;
  }
  console.log("");
  console.log(
    `${outOfSync} file(s) out of sync. ` +
      `Run ${pc.bold(KATA_PLAN_HINT(false))} to inspect, ${pc.bold(KATA_APPLY_HINT(false))} to fix, ` +
      `or ${pc.bold(KATA_IMPORT_HINT)} to pull native edits back.`,
  );
  process.exitCode = 1;
}

export class StatusCommand extends KataCommand {
  static override description =
    "Detect drift: native files changed out-of-band? (exits 1 when out of sync)";
  static override flags = {
    target: Flags.string({ char: "t", multiple: true, description: "only check these targets" }),
    global: Flags.boolean({ char: "g", description: "check the user-level ~/.kata/ config" }),
  };

  override async run(): Promise<void> {
    const { flags } = await this.parse(StatusCommand);
    await runStatus(flags);
  }
}
