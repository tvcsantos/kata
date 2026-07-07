// Explicit oclif command discovery (see the "oclif" section of package.json).
// The CLI is bundled into single files, so file-based discovery cannot work.
import type { Command } from "@oclif/core";
import {
  AddAgentCommand,
  AddInstructionCommand,
  AddMcpCommand,
  AddPromptCommand,
  AddSkillCommand,
} from "./commands/add.js";
import { ApplyCommand } from "./commands/apply.js";
import { DoctorCommand } from "./commands/doctor.js";
import { ImportCommand } from "./commands/import.js";
import { InitCommand } from "./commands/init.js";
import { InstallCommand } from "./commands/install.js";
import { PlanCommand } from "./commands/plan.js";
import { StatusCommand } from "./commands/status.js";
import {
  TargetsDisableCommand,
  TargetsEnableCommand,
  TargetsListCommand,
} from "./commands/targets.js";
import { WatchCommand } from "./commands/watch.js";

export const COMMANDS: Record<string, Command.Class> = {
  init: InitCommand,
  plan: PlanCommand,
  apply: ApplyCommand,
  "add:mcp": AddMcpCommand,
  "add:instruction": AddInstructionCommand,
  "add:prompt": AddPromptCommand,
  "add:agent": AddAgentCommand,
  "add:skill": AddSkillCommand,
  import: ImportCommand,
  install: InstallCommand,
  watch: WatchCommand,
  status: StatusCommand,
  doctor: DoctorCommand,
  "targets:list": TargetsListCommand,
  "targets:enable": TargetsEnableCommand,
  "targets:disable": TargetsDisableCommand,
};
