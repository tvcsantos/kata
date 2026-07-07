import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const CLI = path.resolve(import.meta.dirname, "../dist/index.js");

let tmp: string;

function run(args: string[]) {
  return exec(process.execPath, [CLI, ...args], {
    cwd: tmp,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "kata-e2e-"));
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("kata e2e (built CLI)", () => {
  it("init scaffolds .kata/", async () => {
    const { stdout } = await run(["init"]);
    expect(stdout).toContain("Initialized .kata");
    const config = await readFile(path.join(tmp, ".kata/config.yaml"), "utf8");
    expect(config).toContain("claude-code:");
  });

  it("plan + apply write CLAUDE.md and .mcp.json", async () => {
    // Enable the target regardless of what init detected on this machine,
    // and add real content.
    await run(["targets", "enable", "claude-code"]);
    await writeFile(
      path.join(tmp, ".kata/instructions/base.md"),
      "Always run tests before committing.\n",
      "utf8",
    );
    await mkdir(path.join(tmp, ".kata/mcp"), { recursive: true });
    await writeFile(
      path.join(tmp, ".kata/mcp/servers.yaml"),
      [
        "version: 1",
        "servers:",
        "  github:",
        "    command: npx",
        '    args: ["-y", "@modelcontextprotocol/server-github"]',
        "    env:",
        "      GITHUB_PERSONAL_ACCESS_TOKEN: ${env:GITHUB_TOKEN}",
        "",
      ].join("\n"),
      "utf8",
    );

    const { stdout: planOut } = await run(["plan"]);
    expect(planOut).toContain("CLAUDE.md");
    expect(planOut).toContain(".mcp.json");
    expect(planOut).toContain("create");

    await run(["apply"]);
    const claudeMd = await readFile(path.join(tmp, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("kata:begin");
    expect(claudeMd).toContain("Always run tests before committing.");
    const mcp = JSON.parse(await readFile(path.join(tmp, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers.github.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("${GITHUB_TOKEN}");
  });

  it("second plan reports no changes (idempotent)", async () => {
    const { stdout } = await run(["plan"]);
    expect(stdout).toContain("No changes");
  });

  it("preserves hand-written content outside the managed region", async () => {
    const claudePath = path.join(tmp, "CLAUDE.md");
    const before = await readFile(claudePath, "utf8");
    await writeFile(claudePath, "# Hand-written header\n\n" + before, "utf8");
    await writeFile(
      path.join(tmp, ".kata/instructions/base.md"),
      "Updated instructions.\n",
      "utf8",
    );
    await run(["apply"]);
    const after = await readFile(claudePath, "utf8");
    expect(after).toContain("# Hand-written header");
    expect(after).toContain("Updated instructions.");
    expect(after).not.toContain("Always run tests");
  });

  it("add mcp appends a schema-valid server, preserving comments", async () => {
    const serversPath = path.join(tmp, ".kata/mcp/servers.yaml");
    const withComment = "# team servers\n" + (await readFile(serversPath, "utf8"));
    await writeFile(serversPath, withComment, "utf8");

    await run([
      "add",
      "mcp",
      "remote",
      "--transport",
      "http",
      "--url",
      "https://mcp.example.com/mcp",
      "--header",
      "Authorization=Bearer ${env:EXAMPLE_TOKEN}",
    ]);
    const after = await readFile(serversPath, "utf8");
    expect(after).toContain("# team servers");
    expect(after).toContain("remote:");
    expect(after).toContain("url: https://mcp.example.com/mcp");

    // Duplicate add fails without --force.
    await expect(
      run(["add", "mcp", "remote", "--url", "https://x", "--transport", "http"]),
    ).rejects.toThrow(/already exists/);

    // Invalid definition is rejected by schema validation.
    await expect(run(["add", "mcp", "bad", "--transport", "http"])).rejects.toThrow(
      /requires "url"/,
    );
  });

  it("codex and cursor targets emit their native files", async () => {
    await run(["targets", "enable", "codex"]);
    await run(["targets", "enable", "cursor"]);
    const { stdout: applyOut } = await run(["apply"]);
    // The github fixture maps GITHUB_PERSONAL_ACCESS_TOKEN from a differently
    // named var - Codex can't express that, so it must surface a warning.
    expect(applyOut).toContain("no rename support");

    const agents = await readFile(path.join(tmp, "AGENTS.md"), "utf8");
    expect(agents).toContain("kata:begin");
    expect(agents).toContain("Updated instructions.");

    const codexToml = await readFile(path.join(tmp, ".codex/config.toml"), "utf8");
    expect(codexToml).toContain("[mcp_servers.github]");
    expect(codexToml).toContain('command = "npx"');
    // The unmappable env ref must be skipped, never inlined.
    expect(codexToml).not.toContain("GITHUB_PERSONAL_ACCESS_TOKEN");
    expect(codexToml).toContain("[mcp_servers.remote]");
    expect(codexToml).toContain('bearer_token_env_var = "EXAMPLE_TOKEN"');

    const rule = await readFile(path.join(tmp, ".cursor/rules/kata.mdc"), "utf8");
    expect(rule).toContain("alwaysApply: true");
    const cursorMcp = JSON.parse(await readFile(path.join(tmp, ".cursor/mcp.json"), "utf8"));
    expect(cursorMcp.mcpServers.github.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe(
      "${env:GITHUB_TOKEN}",
    );

    // Idempotent across all targets.
    const { stdout } = await run(["plan"]);
    expect(stdout).toContain("No changes");
  });

  it("preserves foreign servers in .mcp.json", async () => {
    const mcpPath = path.join(tmp, ".mcp.json");
    const current = JSON.parse(await readFile(mcpPath, "utf8"));
    current.mcpServers["hand-added"] = { command: "my-tool" };
    await writeFile(mcpPath, JSON.stringify(current, null, 2), "utf8");
    await run(["apply"]);
    const after = JSON.parse(await readFile(mcpPath, "utf8"));
    expect(after.mcpServers["hand-added"].command).toBe("my-tool");
    expect(after.mcpServers.github).toBeDefined();
  });

  it("applies prompts, agents, and skills to every capable target", async () => {
    await mkdir(path.join(tmp, ".kata/prompts"), { recursive: true });
    await mkdir(path.join(tmp, ".kata/agents"), { recursive: true });
    await mkdir(path.join(tmp, ".kata/skills/deploy"), { recursive: true });
    await writeFile(
      path.join(tmp, ".kata/prompts/ship.md"),
      "---\ndescription: Ship it\n---\nShip the release.\n",
      "utf8",
    );
    await writeFile(
      path.join(tmp, ".kata/agents/tester.md"),
      "---\ndescription: Runs tests\n---\nRun the tests.\n",
      "utf8",
    );
    await writeFile(
      path.join(tmp, ".kata/skills/deploy/SKILL.md"),
      "---\nname: deploy\ndescription: Deploys the app\n---\nDeploy steps.\n",
      "utf8",
    );
    const { stdout } = await run(["apply"]);
    expect(stdout).toContain("user-level only"); // codex prompts warning

    expect(await readFile(path.join(tmp, ".claude/commands/ship.md"), "utf8")).toContain(
      "Ship the release.",
    );
    expect(await readFile(path.join(tmp, ".claude/agents/tester.md"), "utf8")).toContain(
      "Run the tests.",
    );
    expect(await readFile(path.join(tmp, ".claude/skills/deploy/SKILL.md"), "utf8")).toContain(
      "Deploy steps.",
    );
    expect(await readFile(path.join(tmp, ".codex/skills/deploy/SKILL.md"), "utf8")).toContain(
      "Deploy steps.",
    );
    expect(await readFile(path.join(tmp, ".cursor/skills/deploy/SKILL.md"), "utf8")).toContain(
      "Deploy steps.",
    );
    // Cursor command has the frontmatter stripped.
    expect(await readFile(path.join(tmp, ".cursor/commands/ship.md"), "utf8")).toBe(
      "Ship the release.\n",
    );
  });

  it("status reports drift and exits non-zero, then clean after apply", async () => {
    await writeFile(path.join(tmp, ".claude/commands/ship.md"), "tampered\n", "utf8");
    await expect(run(["status"])).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining("drifted"),
    });
    await run(["apply"]);
    const { stdout } = await run(["status"]);
    expect(stdout).toContain("In sync");
  });

  it("doctor reports missing env vars and commands", async () => {
    const { stdout } = await run(["doctor"]);
    expect(stdout).toContain("kata config loads");
    // GITHUB_TOKEN and EXAMPLE_TOKEN are referenced by fixtures but unset.
    expect(stdout).toMatch(/GITHUB_TOKEN is referenced .* but not set/);
    expect(stdout).toContain('command "npx" found on PATH');
  });

  it("gemini, opencode, copilot, and vscode targets emit their native files", async () => {
    for (const target of ["gemini", "opencode", "copilot", "vscode"]) {
      await run(["targets", "enable", target]);
    }
    await run(["apply"]);

    expect(await readFile(path.join(tmp, "GEMINI.md"), "utf8")).toContain("kata:begin");
    const gemini = JSON.parse(await readFile(path.join(tmp, ".gemini/settings.json"), "utf8"));
    expect(gemini.mcpServers.github.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("${GITHUB_TOKEN}");
    expect(await readFile(path.join(tmp, ".gemini/commands/ship.toml"), "utf8")).toContain(
      "Ship the release.",
    );

    const opencode = JSON.parse(await readFile(path.join(tmp, "opencode.json"), "utf8"));
    expect(opencode.mcp.github.type).toBe("local");
    expect(opencode.mcp.github.command[0]).toBe("npx");
    expect(opencode.mcp.github.environment.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("{env:GITHUB_TOKEN}");
    expect(await readFile(path.join(tmp, ".opencode/agents/tester.md"), "utf8")).toContain(
      "mode: subagent",
    );
    expect(await readFile(path.join(tmp, ".opencode/skills/deploy/SKILL.md"), "utf8")).toContain(
      "Deploy steps.",
    );

    const instructions = await readFile(path.join(tmp, ".github/copilot-instructions.md"), "utf8");
    expect(instructions).toContain("kata:begin");
    const sharedMcp = JSON.parse(await readFile(path.join(tmp, ".mcp.json"), "utf8"));
    expect(sharedMcp.mcpServers.github.tools).toEqual(["*"]);
    expect(await readFile(path.join(tmp, ".github/agents/tester.agent.md"), "utf8")).toContain(
      "Run the tests.",
    );
    expect(await readFile(path.join(tmp, ".github/skills/deploy/SKILL.md"), "utf8")).toContain(
      "Deploy steps.",
    );

    const vscodeMcp = JSON.parse(await readFile(path.join(tmp, ".vscode/mcp.json"), "utf8"));
    expect(vscodeMcp.servers.github.type).toBe("stdio");
    expect(vscodeMcp.servers.github.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("${env:GITHUB_TOKEN}");
    expect(await readFile(path.join(tmp, ".github/prompts/ship.prompt.md"), "utf8")).toContain(
      "Ship the release.",
    );

    // All seven targets converge on shared files - a second plan is clean.
    const { stdout } = await run(["plan"]);
    expect(stdout).toContain("No changes");
  });

  it("add scaffolds prompt/skill/agent/instruction files and plan --check gates", async () => {
    await run(["add", "instruction", "60-scaffolded"]);
    await run(["add", "prompt", "triage2", "--description", "Triage issues"]);
    await run(["add", "agent", "reviewer", "--description", "Reviews PRs"]);
    await run(["add", "skill", "release", "--description", "Cuts releases"]);

    expect(await readFile(path.join(tmp, ".kata/prompts/triage2.md"), "utf8")).toContain(
      "description: Triage issues",
    );
    expect(await readFile(path.join(tmp, ".kata/skills/release/SKILL.md"), "utf8")).toContain(
      "name: release",
    );

    // Duplicate add is refused; invalid names too.
    await expect(run(["add", "prompt", "triage2"])).rejects.toThrow(/already exists/);
    await expect(run(["add", "skill", "BadName"])).rejects.toThrow(/lowercase/);

    // New .kata/ files mean pending changes: plan --check gates, apply clears it.
    await expect(run(["plan", "--check", "--no-diff"])).rejects.toMatchObject({ code: 1 });
    await run(["apply"]);
    const { stdout } = await run(["plan", "--check"]);
    expect(stdout).toContain("No changes");
  });

  it("imports native-only artifacts back into kata format", async () => {
    // Hand-written native content that has no counterpart in .kata/.
    await writeFile(
      path.join(tmp, "CLAUDE.md"),
      "# Hand notes\n\n" + (await readFile(path.join(tmp, "CLAUDE.md"), "utf8")),
      "utf8",
    );
    await mkdir(path.join(tmp, ".claude/commands"), { recursive: true });
    await writeFile(path.join(tmp, ".claude/commands/triage.md"), "Triage bugs.\n", "utf8");
    const mcpPath = path.join(tmp, ".mcp.json");
    const mcp = JSON.parse(await readFile(mcpPath, "utf8"));
    mcp.mcpServers["native-only"] = { command: "native-tool", env: { KEY: "${SOME_VAR}" } };
    await writeFile(mcpPath, JSON.stringify(mcp, null, 2), "utf8");

    const { stdout } = await run(["import", "--from", "claude-code"]);
    expect(stdout).toContain("importing from claude-code");

    const inst = await readFile(
      path.join(tmp, ".kata/instructions/imported-claude-code.md"),
      "utf8",
    );
    expect(inst).toContain("Hand notes");
    expect(inst).not.toContain("kata:begin");
    expect(await readFile(path.join(tmp, ".kata/prompts/triage.md"), "utf8")).toBe(
      "Triage bugs.\n",
    );
    const servers = await readFile(path.join(tmp, ".kata/mcp/servers.yaml"), "utf8");
    expect(servers).toContain("native-only:");
    expect(servers).toContain("${env:SOME_VAR}");
    // Existing kata artifacts are skipped, not clobbered.
    expect(stdout).toContain('mcp server "github" already exists');

    // Re-importing skips what we just wrote (idempotent).
    const second = await run(["import", "--from", "claude-code"]);
    expect(second.stdout).toContain("prompts/triage.md already exists, skipped");
  });
});
