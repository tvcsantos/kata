import { Flags } from "@oclif/core";
import pc from "picocolors";
import { planAll, planHasChanges, type Plan } from "@katahq/core";
import { buildRegistry, enabledAdapters, loadProjectFromCwd, makeContext } from "../context.js";
import { renderPlan } from "../render.js";
import { KATA_TARGETS_ENABLE_HINT } from "../hints.js";
import { KataCommand } from "../kata-command.js";

export async function computePlan(only?: string[], global = false): Promise<Plan> {
  const project = await loadProjectFromCwd(global);
  const registry = await buildRegistry();
  const { adapters, unknown } = enabledAdapters(project, registry, only);
  for (const id of unknown) {
    console.error(pc.yellow(`warning: no adapter registered for target "${id}", skipping`));
  }
  if (adapters.length === 0) {
    console.error(
      pc.yellow(`No enabled targets. Enable one with \`${KATA_TARGETS_ENABLE_HINT}\`.`),
    );
  }
  return planAll(adapters, (adapter) => makeContext(project, adapter));
}

export async function runPlan(opts: {
  target?: string[];
  diff: boolean;
  check?: boolean;
  global?: boolean;
}): Promise<void> {
  const plan = await computePlan(opts.target, opts.global ?? false);
  console.log(renderPlan(plan, { diff: opts.diff }));
  if (opts.check && planHasChanges(plan)) process.exitCode = 1;
}

export class PlanCommand extends KataCommand {
  static override description = "Show what native config files would be created or updated";
  static override flags = {
    target: Flags.string({ char: "t", multiple: true, description: "only plan these targets" }),
    diff: Flags.boolean({
      default: true,
      allowNo: true,
      description: "show content diffs (--no-diff to hide)",
    }),
    check: Flags.boolean({ description: "exit 1 when changes exist (CI drift gate)" }),
    global: Flags.boolean({ char: "g", description: "plan the user-level ~/.kata/ config" }),
  };

  override async run(): Promise<void> {
    const { flags } = await this.parse(PlanCommand);
    await runPlan(flags);
  }
}
