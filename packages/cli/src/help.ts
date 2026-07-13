import { Help } from "@oclif/core";
import pc from "picocolors";
import { VERSION } from "./version.js";

const banner = `
  ██╗  ██╗ █████╗ ████████╗ █████╗   ${pc.dim("[")}${pc.cyan("型")}${pc.dim("]")}
  ██║ ██╔╝██╔══██╗╚══██╔══╝██╔══██╗
  █████╔╝ ███████║   ██║   ███████║  ${pc.bold(pc.white("KATA CLI"))} ${pc.dim(`v${VERSION}`)}
  ██╔═██╗ ██╔══██║   ██║   ██╔══██║  ${pc.gray("The single source of truth")}
  ██║  ██╗██║  ██║   ██║   ██║  ██║  ${pc.gray("for all your AI agent harnesses.")}
  ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝
${pc.dim("───────────────────────────────────────────────────────────────────────")}`;

export default class KataHelp extends Help {
  override async showHelp(argv: string[]): Promise<void> {
    console.log(pc.cyan(banner) + "\n");
    await super.showHelp(argv);
  }
}
