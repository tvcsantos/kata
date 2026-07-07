import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const CLI = path.resolve(import.meta.dirname, "../dist/index.js");

let tmp: string;

function run(args: string[], cwd = tmp) {
  return exec(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, NO_COLOR: "1" } });
}

async function write(rel: string, content: string, base = tmp) {
  const abs = path.join(base, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "kata-sharing-"));
  await run(["init"]);
  await run(["targets", "enable", "claude-code"]);
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("compose + install + plugins (built CLI)", () => {
  it("composes a local package, with project artifacts overriding", async () => {
    await write("shared/base-pkg/kata-package.yaml", "name: base-pkg\n");
    await write("shared/base-pkg/instructions/10-style.md", "Style from package.\n");
    await write(
      "shared/base-pkg/mcp/servers.yaml",
      "version: 1\nservers:\n  github:\n    command: from-package\n",
    );
    await write(
      ".kata/config.yaml",
      [
        "version: 1",
        "targets:",
        "  claude-code:",
        "    enabled: true",
        "compose:",
        "  - ./shared/base-pkg",
        "",
      ].join("\n"),
    );
    await write(".kata/instructions/base.md", "Local instruction.\n");
    await write(
      ".kata/mcp/servers.yaml",
      "version: 1\nservers:\n  github:\n    command: from-project\n",
    );

    await run(["apply"]);
    const claudeMd = await readFile(path.join(tmp, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("Style from package.");
    expect(claudeMd).toContain("Local instruction.");
    const mcp = JSON.parse(await readFile(path.join(tmp, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers.github.command).toBe("from-project");
  });

  it("installs a package from a git URL and wires up compose", async () => {
    // A local git repo stands in for a remote package.
    const src = await mkdtemp(path.join(os.tmpdir(), "kata-pkg-src-"));
    try {
      await write("kata-package.yaml", "name: team-standards\nversion: 2.0.0\n", src);
      await write("instructions/50-team.md", "Team standard rules.\n", src);
      const git = (args: string[]) =>
        exec(
          "git",
          [
            "-c",
            "user.email=t@example.com",
            "-c",
            "user.name=t",
            "-c",
            "commit.gpgsign=false",
            ...args,
          ],
          { cwd: src },
        );
      await git(["init", "-q"]);
      await git(["add", "-A"]);
      await git(["commit", "-qm", "init"]);

      const { stdout } = await run(["install", `file://${src}`, "--name", "team-standards"]);
      expect(stdout).toContain("Installed team-standards@2.0.0");

      const config = await readFile(path.join(tmp, ".kata/config.yaml"), "utf8");
      expect(config).toContain("./.kata/packages/team-standards");
      // Vendored: no .git directory inside.
      await expect(
        readFile(path.join(tmp, ".kata/packages/team-standards/.git/HEAD"), "utf8"),
      ).rejects.toThrow();

      await run(["apply"]);
      const claudeMd = await readFile(path.join(tmp, "CLAUDE.md"), "utf8");
      expect(claudeMd).toContain("Team standard rules.");

      // Second install without --force refuses to clobber.
      await expect(run(["install", `file://${src}`, "--name", "team-standards"])).rejects.toThrow(
        /already exists/,
      );
    } finally {
      await rm(src, { recursive: true, force: true });
    }
  });

  it("discovers adapter plugins from node_modules", async () => {
    await write(
      "node_modules/kata-adapter-fake/package.json",
      JSON.stringify({ name: "kata-adapter-fake", type: "module", main: "index.js" }),
    );
    await write(
      "node_modules/kata-adapter-fake/index.js",
      `export default {
        id: "fake-tool",
        displayName: "Fake Tool",
        capabilities: { instructions: "full" },
        async detect() { return true; },
        async emit(context) {
          const body = context.project.instructions.map(i => i.content.trim()).join("\\n\\n");
          return { files: body ? [{ relativePath: "FAKE.md", content: body, strategy: { kind: "replace" } }] : [], warnings: [] };
        },
      };`,
    );

    const { stdout } = await run(["targets", "list"]);
    expect(stdout).toContain("fake-tool");
    expect(stdout).toContain("Fake Tool");

    await run(["targets", "enable", "fake-tool"]);
    await run(["apply", "--target", "fake-tool"]);
    const fake = await readFile(path.join(tmp, "FAKE.md"), "utf8");
    expect(fake).toContain("Team standard rules.");
    expect(fake).toContain("Local instruction.");
  });

  it("watch applies .kata/ edits automatically", { timeout: 20000 }, async () => {
    const child = spawn(process.execPath, [CLI, "watch", "--target", "claude-code"], {
      cwd: tmp,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      let out = "";
      child.stdout.on("data", (d: Buffer) => (out += d.toString()));
      child.stderr.on("data", (d: Buffer) => (out += d.toString()));
      child.on("exit", (code) => (out += `\n[child exited: ${code}]`));
      const until = async (pred: () => Promise<boolean> | boolean, ms: number) => {
        const deadline = Date.now() + ms;
        while (!(await pred()) && Date.now() < deadline) await sleep(100);
        return pred();
      };
      const sawWatching = await until(() => out.includes("Watching"), 8000);
      if (!sawWatching) throw new Error(`watch never reported Watching. Output:\n${out}`);

      await write(".kata/instructions/base.md", "Edited while watching.\n");
      const applied = await until(
        () =>
          readFile(path.join(tmp, "CLAUDE.md"), "utf8").then(
            (c) => c.includes("Edited while watching."),
            () => false,
          ),
        8000,
      );
      expect(applied).toBe(true);
    } finally {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.on("exit", resolve));
    }
  });
});
