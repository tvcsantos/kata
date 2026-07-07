import { Flags } from "@oclif/core";
import pc from "picocolors";
import { applyPlan, displayPath, planHasChanges } from "@katahq/core";
import { computePlan } from "./plan.js";
import { renderPlan } from "../render.js";
import { KataCommand } from "../kata-command.js";

export async function runApply(opts: { target?: string[]; global?: boolean }): Promise<void> {
  const plan = await computePlan(opts.target, opts.global ?? false);
  if (!planHasChanges(plan)) {
    console.log(pc.green("No changes. Native configs are up to date."));
    return;
  }
  console.log(renderPlan(plan, { diff: false }));
  const { written } = await applyPlan(plan);
  console.log("");
  for (const file of written) {
    console.log(pc.green(`wrote ${displayPath(file.relativePath, file.scope)}`));
  }
}

export class ApplyCommand extends KataCommand {
  static override description = "Write native config files for all enabled targets";
  static override flags = {
    target: Flags.string({ char: "t", multiple: true, description: "only apply these targets" }),
    global: Flags.boolean({ char: "g", description: "apply the user-level ~/.kata/ config" }),
  };

  override async run(): Promise<void> {
    const { flags } = await this.parse(ApplyCommand);
    await runApply(flags);
  }
}
