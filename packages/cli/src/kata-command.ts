import { Command } from "@oclif/core";
import pc from "picocolors";

export abstract class KataCommand extends Command {
  protected override async catch(err: Error): Promise<void> {
    console.error(pc.red(err.message));
    process.exitCode = 1;
  }
}
