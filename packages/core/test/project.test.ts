import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findProjectRoot, loadProject } from "@katahq/core";

let tmp: string;

async function scaffold(files: Record<string, string>): Promise<string> {
  tmp = await mkdtemp(path.join(os.tmpdir(), "kata-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(tmp, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
  return tmp;
}

afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("loadProject", () => {
  it("loads config, sorted instructions, and mcp servers", async () => {
    const root = await scaffold({
      ".kata/config.yaml": "version: 1\ntargets:\n  claude-code:\n    enabled: true\n",
      ".kata/instructions/b-second.md": "second",
      ".kata/instructions/a-first.md": "first",
      ".kata/mcp/servers.yaml": [
        "version: 1",
        "servers:",
        "  github:",
        "    command: npx",
        '    args: ["-y", "@modelcontextprotocol/server-github"]',
        "    env:",
        "      TOKEN: ${env:GITHUB_TOKEN}",
      ].join("\n"),
    });

    const project = await loadProject(root);
    expect(project.config.targets["claude-code"]?.enabled).toBe(true);
    expect(project.instructions.map((i) => i.name)).toEqual(["a-first", "b-second"]);
    const github = project.mcpServers["github"];
    expect(github?.transport).toBe("stdio");
    expect(github?.env["TOKEN"]).toBe("${env:GITHUB_TOKEN}");
  });

  it("rejects an http server without url", async () => {
    const root = await scaffold({
      ".kata/config.yaml": "version: 1\n",
      ".kata/mcp/servers.yaml": "version: 1\nservers:\n  bad:\n    transport: http\n",
    });
    await expect(loadProject(root)).rejects.toThrow(/requires "url"/);
  });

  it("loads prompts, agents, and skills", async () => {
    const root = await scaffold({
      ".kata/config.yaml": "version: 1\n",
      ".kata/prompts/review.md": "---\ndescription: Review code\n---\nReview this.\n",
      ".kata/agents/tester.md": "---\ndescription: Runs tests\n---\nYou run tests.\n",
      ".kata/skills/deploy/SKILL.md":
        "---\nname: deploy\ndescription: Deploys\n---\nHow to deploy.\n",
      ".kata/skills/deploy/scripts/run.sh": "#!/bin/sh\necho hi\n",
    });
    const project = await loadProject(root);
    expect(project.prompts.map((p) => p.name)).toEqual(["review"]);
    expect(project.prompts[0]?.content).toContain("description: Review code");
    expect(project.agents.map((a) => a.name)).toEqual(["tester"]);
    expect(project.skills.map((s) => s.name)).toEqual(["deploy"]);
    expect(project.skills[0]?.files.map((f) => f.relativePath)).toEqual([
      "SKILL.md",
      "scripts/run.sh",
    ]);
  });

  it("loads binary skill assets as Buffers, text as strings", async () => {
    const root = await scaffold({
      ".kata/config.yaml": "version: 1\n",
      ".kata/skills/logo/SKILL.md": "---\nname: logo\n---\nUse the logo.\n",
    });
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
    const assetPath = path.join(root, ".kata", "skills", "logo", "assets", "logo.png");
    await mkdir(path.dirname(assetPath), { recursive: true });
    await writeFile(assetPath, bytes);

    const project = await loadProject(root);
    const files = project.skills[0]?.files ?? [];
    expect(typeof files.find((f) => f.relativePath === "SKILL.md")?.content).toBe("string");
    const asset = files.find((f) => f.relativePath === "assets/logo.png")?.content;
    expect(Buffer.isBuffer(asset)).toBe(true);
    expect((asset as Buffer).equals(bytes)).toBe(true);
  });

  it("rejects a skill directory without SKILL.md", async () => {
    const root = await scaffold({
      ".kata/config.yaml": "version: 1\n",
      ".kata/skills/broken/notes.md": "no skill file",
    });
    await expect(loadProject(root)).rejects.toThrow(/missing its SKILL\.md/);
  });

  it("composes packages in order with local artifacts overriding", async () => {
    const root = await scaffold({
      // Package A: baseline instruction + a server + a prompt.
      "shared/pkg-a/kata-package.yaml": "name: pkg-a\nversion: 1.0.0\n",
      "shared/pkg-a/instructions/10-style.md": "Style from A.\n",
      "shared/pkg-a/prompts/review.md": "Review prompt from A.\n",
      "shared/pkg-a/mcp/servers.yaml": "version: 1\nservers:\n  github:\n    command: from-a\n",
      // Package B (later): overrides A's instruction file by name.
      "shared/pkg-b/kata-package.yaml": "name: pkg-b\n",
      "shared/pkg-b/instructions/10-style.md": "Style from B.\n",
      "shared/pkg-b/instructions/20-extra.md": "Extra from B.\n",
      // Project: overrides the server and adds its own instruction.
      ".kata/config.yaml": [
        "version: 1",
        "compose:",
        "  - ./shared/pkg-a",
        "  - ./shared/pkg-b",
        "",
      ].join("\n"),
      ".kata/instructions/30-local.md": "Local rules.\n",
      ".kata/mcp/servers.yaml": "version: 1\nservers:\n  github:\n    command: from-project\n",
    });

    const project = await loadProject(root);
    expect(project.packages.map((p) => p.manifest.name)).toEqual(["pkg-a", "pkg-b"]);
    expect(project.instructions.map((i) => [i.name, i.content.trim()])).toEqual([
      ["10-style", "Style from B."],
      ["20-extra", "Extra from B."],
      ["30-local", "Local rules."],
    ]);
    expect(project.mcpServers["github"]?.command).toBe("from-project");
    expect(project.prompts.map((p) => p.name)).toEqual(["review"]);
  });

  it("fails clearly when a composed package has no manifest", async () => {
    const root = await scaffold({
      "shared/no-manifest/instructions/x.md": "x",
      ".kata/config.yaml": "version: 1\ncompose:\n  - ./shared/no-manifest\n",
    });
    await expect(loadProject(root)).rejects.toThrow(/no kata-package\.yaml/);
  });

  it("fails clearly on an unsupported compose ref", async () => {
    const root = await scaffold({
      ".kata/config.yaml": "version: 1\ncompose:\n  - 'git:https://example.com/x'\n",
    });
    await expect(loadProject(root)).rejects.toThrow(/not supported/);
  });

  it("findProjectRoot walks up from nested dirs", async () => {
    const root = await scaffold({
      ".kata/config.yaml": "version: 1\n",
      "src/deep/file.txt": "x",
    });
    expect(await findProjectRoot(path.join(root, "src", "deep"))).toBe(root);
  });
});
