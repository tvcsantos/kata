import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Args, Flags } from "@oclif/core";
import pc from "picocolors";
import { parseDocument } from "yaml";
import {
  displayAbsolutePath,
  exists,
  makeAgentRelativePath,
  makeInstructionRelativePath,
  makeMcpServerPath,
  makePromptRelativePath,
  makeSkillRelativePath,
  MCP_SERVERS_SCHEMA_VERSION,
  mcpServerSchema,
  readTextFileOrDefault,
} from "@katahq/core";
import { loadProjectFromCwd } from "../context.js";
import {
  AGENT_TEMPLATE,
  INSTRUCTION_TEMPLATE,
  MCP_SERVERS_EMPTY_TEMPLATE,
  PROMPT_TEMPLATE,
  SKILL_TEMPLATE,
} from "../templates.js";
import { KATA_APPLY_HINT, KATA_PLAN_HINT } from "../hints.js";
import { KataCommand } from "../kata-command.js";

export interface AddMcpOptions {
  transport: string;
  command?: string;
  arg: string[];
  env: string[];
  url?: string;
  header: string[];
  scope: string;
  force?: boolean;
  global?: boolean;
}

function parseKeyValues(pairs: string[], flag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of pairs) {
    const index = pair.indexOf("=");
    if (index <= 0) {
      throw new Error(`Invalid ${flag} value "${pair}" - expected KEY=VALUE`);
    }
    result[pair.slice(0, index)] = pair.slice(index + 1);
  }
  return result;
}

const NAME_REGEX = /^[a-z0-9][a-z0-9._-]*$/i;

export interface AddFileOptions {
  description?: string;
  force?: boolean;
  global?: boolean;
}

async function writeArtifactFile(
  relativePath: string,
  content: string,
  opts: AddFileOptions,
): Promise<void> {
  const global = opts.global ?? false;
  const project = await loadProjectFromCwd(global);
  const absolutePath = path.join(project.configDir, relativePath);
  const shownPath = displayAbsolutePath(project.rootDir, project.scope, absolutePath);

  if (!(opts.force ?? false) && (await exists(absolutePath))) {
    throw new Error(`${shownPath} already exists (use --force to overwrite).`);
  }

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
  console.log(
    `Created ${pc.bold(shownPath)} - edit it, then run ${pc.bold(KATA_APPLY_HINT(global))}.`,
  );
}

function checkName(name: string): void {
  if (!NAME_REGEX.test(name)) {
    throw new Error(`Invalid name "${name}" - use letters, digits, dots, dashes, underscores.`);
  }
}

export async function runAddInstruction(name: string, opts: AddFileOptions): Promise<void> {
  checkName(name);
  await writeArtifactFile(makeInstructionRelativePath(name), INSTRUCTION_TEMPLATE, opts);
}

export async function runAddPrompt(name: string, opts: AddFileOptions): Promise<void> {
  checkName(name);
  const description = opts.description ?? `The /${name} command`;
  await writeArtifactFile(makePromptRelativePath(name), PROMPT_TEMPLATE(description), opts);
}

export async function runAddAgent(name: string, opts: AddFileOptions): Promise<void> {
  checkName(name);
  const description = opts.description ?? `The ${name} subagent`;
  await writeArtifactFile(makeAgentRelativePath(name), AGENT_TEMPLATE(description), opts);
}

export async function runAddSkill(name: string, opts: AddFileOptions): Promise<void> {
  checkName(name);
  if (name !== name.toLowerCase()) {
    // The Agent Skills convention requires lowercase names matching the folder.
    throw new Error(`Skill names must be lowercase (got "${name}").`);
  }
  const description = opts.description ?? `Describe what the ${name} skill does and when to use it`;
  await writeArtifactFile(makeSkillRelativePath(name), SKILL_TEMPLATE(name, description), opts);
}

export async function runAddMcp(name: string, opts: AddMcpOptions): Promise<void> {
  const global = opts.global ?? false;
  const project = await loadProjectFromCwd(global);

  const server: Record<string, unknown> = { transport: opts.transport };
  if (opts.command) server.command = opts.command;
  if (opts.arg.length > 0) server.args = opts.arg;
  const env = parseKeyValues(opts.env, "--env");
  if (Object.keys(env).length > 0) server.env = env;
  if (opts.url) server.url = opts.url;
  const headers = parseKeyValues(opts.header, "--header");
  if (Object.keys(headers).length > 0) server.headers = headers;
  if (opts.scope !== "project") server.scope = opts.scope;

  const result = mcpServerSchema.safeParse(server);
  if (!result.success) {
    throw new Error(
      `Invalid server definition:\n${result.error.issues.map((issue) => `  - ${issue.message}`).join("\n")}`,
    );
  }

  const serversPath = makeMcpServerPath(project.configDir);
  const shownServersPath = displayAbsolutePath(project.rootDir, project.scope, serversPath);
  const raw = await readTextFileOrDefault(serversPath, MCP_SERVERS_EMPTY_TEMPLATE);
  // Edit via the YAML document API so user comments survive.
  const doc = parseDocument(raw);
  if (doc.getIn(["servers", name]) !== undefined && !opts.force) {
    throw new Error(
      `Server "${name}" already exists in ${shownServersPath} (use --force to overwrite).`,
    );
  }
  if (doc.get("version") === undefined) doc.set("version", MCP_SERVERS_SCHEMA_VERSION);
  doc.setIn(["servers", name], doc.createNode(server));

  await mkdir(path.dirname(serversPath), { recursive: true });
  await writeFile(serversPath, doc.toString(), "utf8");
  console.log(`Added MCP server ${pc.bold(name)} to ${shownServersPath}.`);
  console.log(`Run ${pc.bold(KATA_PLAN_HINT(global))} to see what it changes.`);
}

const NAME_ARG = { name: Args.string({ required: true, description: "artifact name" }) };

const ADD_FILE_FLAGS = {
  description: Flags.string({ char: "d", description: "artifact description" }),
  force: Flags.boolean({ description: "overwrite if it exists" }),
  global: Flags.boolean({ char: "g", description: "add to the user-level ~/.kata/ config" }),
};

export class AddMcpCommand extends KataCommand {
  static override description = "Add an MCP server definition";
  static override args = NAME_ARG;
  static override flags = {
    transport: Flags.string({ description: "stdio | http | sse", default: "stdio" }),
    command: Flags.string({ description: "executable to launch (stdio)" }),
    arg: Flags.string({
      multiple: true,
      default: [],
      description: "command argument (repeatable)",
    }),
    env: Flags.string({
      multiple: true,
      default: [],
      description: "env var, value may use ${env:VAR} (repeatable)",
    }),
    url: Flags.string({ description: "server endpoint (http/sse)" }),
    header: Flags.string({ multiple: true, default: [], description: "HTTP header (repeatable)" }),
    scope: Flags.string({ description: "project | global", default: "project" }),
    force: Flags.boolean({ description: "overwrite an existing server with the same name" }),
    global: Flags.boolean({ char: "g", description: "add to the user-level ~/.kata/ config" }),
  };

  override async run(): Promise<void> {
    const { args, flags } = await this.parse(AddMcpCommand);
    await runAddMcp(args.name, flags);
  }
}

export class AddInstructionCommand extends KataCommand {
  static override description = "Add an instruction file";
  static override args = NAME_ARG;
  // Instructions are plain markdown without frontmatter, so no --description here.
  static override flags = { force: ADD_FILE_FLAGS.force, global: ADD_FILE_FLAGS.global };

  override async run(): Promise<void> {
    const { args, flags } = await this.parse(AddInstructionCommand);
    await runAddInstruction(args.name, flags);
  }
}

export class AddPromptCommand extends KataCommand {
  static override description = "Add a reusable prompt / slash command";
  static override args = NAME_ARG;
  static override flags = ADD_FILE_FLAGS;

  override async run(): Promise<void> {
    const { args, flags } = await this.parse(AddPromptCommand);
    await runAddPrompt(args.name, flags);
  }
}

export class AddAgentCommand extends KataCommand {
  static override description = "Add a subagent definition";
  static override args = NAME_ARG;
  static override flags = ADD_FILE_FLAGS;

  override async run(): Promise<void> {
    const { args, flags } = await this.parse(AddAgentCommand);
    await runAddAgent(args.name, flags);
  }
}

export class AddSkillCommand extends KataCommand {
  static override description = "Add a skill (creates skills/<name>/SKILL.md)";
  static override args = NAME_ARG;
  static override flags = ADD_FILE_FLAGS;

  override async run(): Promise<void> {
    const { args, flags } = await this.parse(AddSkillCommand);
    await runAddSkill(args.name, flags);
  }
}
