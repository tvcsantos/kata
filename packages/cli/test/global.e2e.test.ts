import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const CLI = path.resolve(import.meta.dirname, "../dist/index.js");

let tmp: string;
let fakeHome: string;
let projDir: string;

function run(args: string[], cwd = projDir) {
  return exec(process.execPath, [CLI, ...args], {
    cwd,
    // os.homedir() reads HOME (POSIX) / USERPROFILE (Windows).
    env: { ...process.env, NO_COLOR: "1", HOME: fakeHome, USERPROFILE: fakeHome },
  });
}

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "kata-global-e2e-"));
  fakeHome = path.join(tmp, "home");
  projDir = path.join(tmp, "proj");
  await mkdir(fakeHome, { recursive: true });
  await mkdir(projDir, { recursive: true });
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("kata --global e2e (built CLI)", () => {
  it("init --global scaffolds ~/.kata/", async () => {
    const { stdout } = await run(["init", "--global"]);
    expect(stdout).toContain("Initialized ~/.kata");
    const config = await readFile(path.join(fakeHome, ".kata/config.yaml"), "utf8");
    expect(config).toContain("claude-code:");
  });

  it("apply --global writes user-level native files", async () => {
    await run(["targets", "enable", "claude-code", "--global"]);
    await run(["targets", "enable", "codex", "--global"]);
    await writeFile(
      path.join(fakeHome, ".kata/instructions/base.md"),
      "Always be concise.\n",
      "utf8",
    );
    await writeFile(
      path.join(fakeHome, ".kata/mcp/servers.yaml"),
      ["version: 1", "servers:", "  github:", "    command: npx", ""].join("\n"),
      "utf8",
    );
    await mkdir(path.join(fakeHome, ".kata/prompts"), { recursive: true });
    await writeFile(path.join(fakeHome, ".kata/prompts/ship.md"), "Ship it.\n", "utf8");

    const { stdout } = await run(["apply", "--global"]);
    expect(stdout).toContain("wrote ~/.claude/CLAUDE.md");

    expect(await readFile(path.join(fakeHome, ".claude/CLAUDE.md"), "utf8")).toContain(
      "Always be concise.",
    );
    const claudeJson = JSON.parse(await readFile(path.join(fakeHome, ".claude.json"), "utf8"));
    expect(claudeJson.mcpServers.github.command).toBe("npx");
    expect(await readFile(path.join(fakeHome, ".codex/AGENTS.md"), "utf8")).toContain(
      "Always be concise.",
    );
    expect(await readFile(path.join(fakeHome, ".codex/config.toml"), "utf8")).toContain(
      "[mcp_servers.github]",
    );
    // Codex prompts are user-level only, so the global run emits them.
    expect(await readFile(path.join(fakeHome, ".codex/prompts/ship.md"), "utf8")).toBe(
      "Ship it.\n",
    );
    expect(await readFile(path.join(fakeHome, ".claude/commands/ship.md"), "utf8")).toBe(
      "Ship it.\n",
    );

    // Idempotent.
    const plan = await run(["plan", "--global"]);
    expect(plan.stdout).toContain("No changes");
  });

  it("~/.claude.json merge preserves existing state", async () => {
    const p = path.join(fakeHome, ".claude.json");
    const current = JSON.parse(await readFile(p, "utf8"));
    current.someToolState = { theme: "dark" };
    current.mcpServers["hand-added"] = { command: "my-tool" };
    await writeFile(p, JSON.stringify(current, null, 2), "utf8");
    await run(["apply", "--global"]);
    const after = JSON.parse(await readFile(p, "utf8"));
    expect(after.someToolState.theme).toBe("dark");
    expect(after.mcpServers["hand-added"].command).toBe("my-tool");
    expect(after.mcpServers.github.command).toBe("npx");
  });

  it("a project apply routes scope:global servers to the home dir", async () => {
    await run(["init"], projDir);
    await run(["targets", "enable", "claude-code"], projDir);
    await writeFile(path.join(projDir, ".kata/instructions/base.md"), "Project rules.\n", "utf8");
    await writeFile(
      path.join(projDir, ".kata/mcp/servers.yaml"),
      [
        "version: 1",
        "servers:",
        "  local-server:",
        "    command: local-tool",
        "  personal-server:",
        "    command: personal-tool",
        "    scope: global",
        "",
      ].join("\n"),
      "utf8",
    );

    const { stdout } = await run(["apply"], projDir);
    expect(stdout).toContain("wrote .mcp.json");
    expect(stdout).toContain("wrote ~/.claude.json");

    const projectMcp = JSON.parse(await readFile(path.join(projDir, ".mcp.json"), "utf8"));
    expect(Object.keys(projectMcp.mcpServers)).toEqual(["local-server"]);
    const claudeJson = JSON.parse(await readFile(path.join(fakeHome, ".claude.json"), "utf8"));
    expect(claudeJson.mcpServers["personal-server"].command).toBe("personal-tool");
    // Global config's own server, written earlier, survives the merge.
    expect(claudeJson.mcpServers.github.command).toBe("npx");
  });

  it("status --global detects drift in user-level files", async () => {
    await writeFile(path.join(fakeHome, ".claude/commands/ship.md"), "tampered\n", "utf8");
    await expect(run(["status", "--global"])).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining("drifted  ~/.claude/commands/ship.md"),
    });
    await run(["apply", "--global"]);
    const { stdout } = await run(["status", "--global"]);
    expect(stdout).toContain("In sync");
  });

  it("does not treat the home dir as a project root", async () => {
    // cwd is a directory under home with no project .kata; ~/.kata exists but
    // must only be reachable via --global.
    const nested = path.join(fakeHome, "somewhere");
    await mkdir(nested, { recursive: true });
    await expect(run(["plan"], nested)).rejects.toThrow(/No \.kata\/config\.yaml found/);
  });
});
