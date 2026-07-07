import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyPlan,
  displayPath,
  planTarget,
  type Adapter,
  type AdapterContext,
  type Project,
} from "@katahq/core";

let tmp: string;

afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

function makeContext(projectRoot: string, homeDir: string): AdapterContext {
  const project: Project = {
    rootDir: projectRoot,
    configDir: path.join(projectRoot, ".kata"),
    config: { version: 1, targets: {} },
    packages: [],
    scope: "project",
    instructions: [],
    mcpServers: {},
    prompts: [],
    agents: [],
    skills: [],
  };
  return { project, projectRoot, homeDir, scope: "project", targetOptions: {} };
}

const fakeAdapter: Adapter = {
  id: "fake",
  displayName: "Fake",
  capabilities: {},
  detect: async () => true,
  emit: async () => ({
    files: [
      { relativePath: "PROJECT.md", content: "project file", strategy: { kind: "replace" } },
      {
        relativePath: ".fake/global.md",
        scope: "global",
        content: "global file",
        strategy: { kind: "replace" },
      },
    ],
    warnings: [],
  }),
};

describe("planTarget scope resolution", () => {
  it("resolves project files against projectRoot and global files against homeDir", async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "kata-plan-"));
    const projectRoot = path.join(tmp, "proj");
    const homeDir = path.join(tmp, "home");
    const plan = await planTarget(fakeAdapter, makeContext(projectRoot, homeDir));

    const project = plan.files.find((f) => f.relativePath === "PROJECT.md")!;
    expect(project.scope).toBe("project");
    expect(project.absolutePath).toBe(path.join(projectRoot, "PROJECT.md"));

    const global = plan.files.find((f) => f.relativePath === ".fake/global.md")!;
    expect(global.scope).toBe("global");
    expect(global.absolutePath).toBe(path.join(homeDir, ".fake/global.md"));
  });

  it("diffs global files against their home-dir content", async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "kata-plan-"));
    const projectRoot = path.join(tmp, "proj");
    const homeDir = path.join(tmp, "home");
    await mkdir(path.join(homeDir, ".fake"), { recursive: true });
    await writeFile(path.join(homeDir, ".fake", "global.md"), "global file\n", "utf8");

    const plan = await planTarget(fakeAdapter, makeContext(projectRoot, homeDir));
    expect(plan.files.find((f) => f.relativePath === ".fake/global.md")?.action).toBe("unchanged");
    expect(plan.files.find((f) => f.relativePath === "PROJECT.md")?.action).toBe("create");
  });

  it("round-trips binary files byte-for-byte through plan and apply", async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "kata-plan-"));
    const projectRoot = path.join(tmp, "proj");
    const homeDir = path.join(tmp, "home");
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
    const binaryAdapter: Adapter = {
      id: "binary",
      displayName: "Binary",
      capabilities: {},
      detect: async () => true,
      emit: async () => ({
        files: [{ relativePath: "assets/logo.png", content: bytes, strategy: { kind: "replace" } }],
        warnings: [],
      }),
    };

    const first = await planTarget(binaryAdapter, makeContext(projectRoot, homeDir));
    expect(first.files[0]?.action).toBe("create");
    await applyPlan({ targets: [first] });

    const onDisk = await readFile(path.join(projectRoot, "assets", "logo.png"));
    expect(onDisk.equals(bytes)).toBe(true);

    const second = await planTarget(binaryAdapter, makeContext(projectRoot, homeDir));
    expect(second.files[0]?.action).toBe("unchanged");
  });

  it("displayPath prefixes global files with ~/", () => {
    expect(displayPath(".fake/global.md", "global")).toBe("~/.fake/global.md");
    expect(displayPath("PROJECT.md", "project")).toBe("PROJECT.md");
  });
});
