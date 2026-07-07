import { watch } from "node:fs";
import path from "node:path";
import { Flags } from "@oclif/core";
import pc from "picocolors";
import { applyPlan, displayPath, planHasChanges } from "@katahq/core";
import { loadProjectFromCwd } from "../context.js";
import { computePlan } from "./plan.js";
import { KataCommand } from "../kata-command.js";

/** Re-apply whenever `.kata/` changes. Ctrl-C to stop. */
export async function runWatch(opts: { target?: string[]; global?: boolean }): Promise<void> {
  const global = opts.global ?? false;
  const project = await loadProjectFromCwd(global);

  let running = false;
  let queued = false;
  const applyOnce = async () => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      const plan = await computePlan(opts.target, global);
      if (planHasChanges(plan)) {
        const { written } = await applyPlan(plan);
        for (const file of written) {
          console.log(
            `${pc.dim(new Date().toLocaleTimeString())} ${pc.green("wrote")} ${displayPath(file.relativePath, file.scope)}`,
          );
        }
      }
    } catch (err) {
      console.error(pc.red((err as Error).message));
    } finally {
      running = false;
      if (queued) {
        queued = false;
        void applyOnce();
      }
    }
  };

  await applyOnce();

  const watchedPath = path.relative(project.rootDir, project.configDir) || ".";

  console.log(`Watching ${pc.bold(watchedPath)} - applying on change. Ctrl-C to stop.`);

  let timer: NodeJS.Timeout | null = null;
  const watcher = watch(project.configDir, { recursive: true }, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void applyOnce(), 300);
  });

  // Keep the process alive until interrupted, then release the event loop.
  await new Promise<void>((resolve) => {
    process.on("SIGINT", resolve);
    process.on("SIGTERM", resolve);
  });
  if (timer) clearTimeout(timer);
  watcher.close();
}

export class WatchCommand extends KataCommand {
  static override description = "Re-apply whenever .kata/ changes";
  static override flags = {
    target: Flags.string({ char: "t", multiple: true, description: "only apply these targets" }),
    global: Flags.boolean({ char: "g", description: "watch the user-level ~/.kata/ config" }),
  };

  override async run(): Promise<void> {
    const { flags } = await this.parse(WatchCommand);
    await runWatch(flags);
  }
}
