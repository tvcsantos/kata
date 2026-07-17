import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeFileDiff,
  exists,
  initProject,
  openProject,
  parsePackageSource,
  planHasChanges,
  slugFromGitUrl,
  summarizePlan,
  type Adapter,
} from "@katahq/core";

const exec = promisify(execFile);

const dirsToCleanUp: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  dirsToCleanUp.push(dir);
  return dir;
}

async function scaffold(baseDir: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(baseDir, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
}

async function scaffoldProject(): Promise<string> {
  const root = await makeTempDir("kata-engine-");
  await scaffold(root, { ".kata/config.yaml": "version: 1\ntargets: {}\n" });
  return root;
}

/** A local git repo containing a kata package, standing in for a remote. */
async function makePackageRepo(files: Record<string, string>): Promise<string> {
  const repoDir = await makeTempDir("kata-pkg-src-");
  await scaffold(repoDir, files);
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
      { cwd: repoDir },
    );
  await git(["init", "-q"]);
  await git(["add", "-A"]);
  await git(["commit", "-qm", "init"]);
  return repoDir;
}

afterEach(async () => {
  while (dirsToCleanUp.length > 0) {
    await rm(dirsToCleanUp.pop() as string, { recursive: true, force: true });
  }
});

describe("parsePackageSource", () => {
  it("classifies git URLs, npm refs, and local paths", () => {
    expect(parsePackageSource("https://github.com/acme/pkg.git")).toEqual({
      kind: "git",
      url: "https://github.com/acme/pkg.git",
    });
    expect(parsePackageSource("git+https://github.com/acme/pkg.git")).toEqual({
      kind: "git",
      url: "https://github.com/acme/pkg.git",
    });
    expect(parsePackageSource("npm:@acme/standards")).toEqual({
      kind: "npm",
      packageName: "@acme/standards",
    });
    expect(parsePackageSource("./shared/base-pkg")).toEqual({
      kind: "path",
      path: "./shared/base-pkg",
    });
    expect(() => parsePackageSource("not-a-source")).toThrow(/Unsupported ref/);
  });

  it("derives install directory slugs from git URLs", () => {
    expect(slugFromGitUrl("https://github.com/acme/Agent-Standards.git")).toBe("agent-standards");
    expect(slugFromGitUrl("git@github.com:acme/pkg.git")).toBe("pkg");
  });

  it("parses #path: monorepo subdirectories on git refs", () => {
    expect(parsePackageSource("https://github.com/acme/bundles.git#path:packs/one")).toEqual({
      kind: "git",
      url: "https://github.com/acme/bundles.git",
      subdir: "packs/one",
    });
    expect(parsePackageSource("git+https://github.com/acme/bundles.git#path:/packs/one/")).toEqual({
      kind: "git",
      url: "https://github.com/acme/bundles.git",
      subdir: "packs/one",
    });
    expect(parsePackageSource("https://github.com/acme/pkg.git#path:")).toEqual({
      kind: "git",
      url: "https://github.com/acme/pkg.git",
    });
  });
});

describe("KataProject install/uninstall", () => {
  it("vendors a git package, records provenance, and appends compose", async () => {
    const root = await scaffoldProject();
    const repoDir = await makePackageRepo({
      "kata-package.yaml": "name: team-standards\nversion: 2.0.0\n",
      "instructions/50-team.md": "Team standard rules.\n",
    });

    const project = await openProject(root);
    const phases: string[] = [];
    const result = await project.install(
      { kind: "git", url: `file://${repoDir}` },
      { onProgress: (progress) => phases.push(progress.phase) },
    );

    expect(result.package.manifest.name).toBe("team-standards");
    expect(result.addedToCompose).toBe(true);
    expect(result.vendoredCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(phases).toEqual(["clone", "vendor", "verify"]);

    const config = await readFile(path.join(root, ".kata/config.yaml"), "utf8");
    expect(config).toContain(result.composeRef);
    expect(await exists(path.join(result.package.dir, ".git"))).toBe(false);
    expect(await exists(path.join(result.package.dir, ".kata-source.yaml"))).toBe(true);

    const installed = await project.installedPackages();
    expect(installed).toHaveLength(1);
    expect(installed[0]?.name).toBe("team-standards");
    expect(installed[0]?.version).toBe("2.0.0");
    expect(installed[0]?.source).toEqual({ kind: "git", url: `file://${repoDir}` });
    expect(installed[0]?.vendoredCommit).toBe(result.vendoredCommit);
  });

  it("refuses to clobber an existing vendored dir without force", async () => {
    const root = await scaffoldProject();
    const repoDir = await makePackageRepo({ "kata-package.yaml": "name: pkg\n" });
    const project = await openProject(root);
    const source = { kind: "git", url: `file://${repoDir}` } as const;

    await project.install(source, { name: "pkg" });
    await expect(project.install(source, { name: "pkg" })).rejects.toThrow(/already exists/);
    const forced = await project.install(source, { name: "pkg", force: true });
    expect(forced.addedToCompose).toBe(false);
  });

  it("rejects a git repo without a manifest and leaves no trace", async () => {
    const root = await scaffoldProject();
    const repoDir = await makePackageRepo({ "README.md": "not a package\n" });
    const project = await openProject(root);

    await expect(
      project.install({ kind: "git", url: `file://${repoDir}` }, { name: "not-a-pkg" }),
    ).rejects.toThrow(/no kata-package.yaml/);
    expect(await exists(path.join(root, ".kata/packages/not-a-pkg"))).toBe(false);
    const config = await readFile(path.join(root, ".kata/config.yaml"), "utf8");
    expect(config).not.toContain("not-a-pkg");
  });

  it("installs a local path package by wiring compose only", async () => {
    const root = await scaffoldProject();
    await scaffold(root, {
      "shared/base-pkg/kata-package.yaml": "name: base-pkg\n",
      "shared/base-pkg/instructions/10-style.md": "Style.\n",
    });

    const project = await openProject(root);
    const result = await project.install({ kind: "path", path: "./shared/base-pkg" });
    expect(result.composeRef).toBe("./shared/base-pkg");
    expect(result.addedToCompose).toBe(true);

    const installed = await project.installedPackages();
    expect(installed[0]?.source).toEqual({ kind: "path", path: "./shared/base-pkg" });
  });

  it("uninstalls by name: compose entry removed, vendored dir deleted", async () => {
    const root = await scaffoldProject();
    const repoDir = await makePackageRepo({
      "kata-package.yaml": "name: team-standards\n",
    });
    const project = await openProject(root);
    const { package: pkg } = await project.install({ kind: "git", url: `file://${repoDir}` });

    const result = await project.uninstall("team-standards");
    expect(result.removedDir).toBe(true);
    expect(await exists(pkg.dir)).toBe(false);
    const config = await readFile(path.join(root, ".kata/config.yaml"), "utf8");
    expect(config).not.toContain("team-standards");
    expect(await project.installedPackages()).toEqual([]);

    await expect(project.uninstall("team-standards")).rejects.toThrow(/No installed package/);
  });

  it("installs a bundle from a monorepo subdirectory and updates it", async () => {
    const root = await makeTempDir("kata-engine-");
    await scaffold(root, {
      ".kata/config.yaml": "version: 1\ntargets:\n  fake-tool:\n    enabled: true\n",
    });
    const repoDir = await makePackageRepo({
      "README.md": "monorepo of bundles - no manifest at the root\n",
      "packs/one/kata-package.yaml": "name: pack-one\nversion: 1.0.0\n",
      "packs/one/instructions/10-one.md": "Rules of one.\n",
      "packs/two/kata-package.yaml": "name: pack-two\n",
    });

    const project = await openProject(root, { adapters: [fakeAdapter] });
    const result = await project.install({
      kind: "git",
      url: `file://${repoDir}`,
      subdir: "packs/one",
    });

    // Vendored under the subdir's name, only that bundle's content.
    expect(result.package.manifest.name).toBe("pack-one");
    expect(path.basename(result.package.dir)).toBe("one");
    expect(await exists(path.join(result.package.dir, "instructions/10-one.md"))).toBe(true);
    expect(await exists(path.join(result.package.dir, "packs"))).toBe(false);

    const installed = await project.installedPackages();
    expect(installed[0]?.source).toEqual({
      kind: "git",
      url: `file://${repoDir}`,
      subdir: "packs/one",
    });

    // Upstream bumps only this bundle; update follows the recorded subdir.
    await scaffold(repoDir, { "packs/one/instructions/10-one.md": "New rules of one.\n" });
    const git = (args: string[]) =>
      exec("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
        cwd: repoDir,
      });
    await git(["add", "-A"]);
    await git(["-c", "commit.gpgsign=false", "commit", "-qm", "bump one"]);

    const stagedUpdate = await project.stageUpdate("pack-one");
    expect(String(stagedUpdate.plan.targets[0]!.files[0]!.newContent)).toContain(
      "New rules of one.",
    );
    await stagedUpdate.confirm();
    expect(await readFile(path.join(root, "FAKE.md"), "utf8")).toContain("New rules of one.");
  });

  it("rejects a subdir without a manifest, naming the subdir", async () => {
    const root = await scaffoldProject();
    const repoDir = await makePackageRepo({ "packs/one/kata-package.yaml": "name: pack-one\n" });
    const project = await openProject(root);
    await expect(
      project.install({ kind: "git", url: `file://${repoDir}`, subdir: "packs/missing" }),
    ).rejects.toThrow(/at packs\/missing is not an kata package/);
  });

  it("uninstalling a local path package keeps the directory", async () => {
    const root = await scaffoldProject();
    await scaffold(root, { "shared/base-pkg/kata-package.yaml": "name: base-pkg\n" });
    const project = await openProject(root);
    await project.install({ kind: "path", path: "./shared/base-pkg" });

    const result = await project.uninstall("base-pkg");
    expect(result.removedDir).toBe(false);
    expect(await exists(path.join(root, "shared/base-pkg"))).toBe(true);
  });
});

const fakeAdapter: Adapter = {
  id: "fake-tool",
  displayName: "Fake Tool",
  capabilities: { instructions: "full" },
  async detect() {
    return true;
  },
  async emit(context) {
    const body = context.project.instructions.map((i) => i.content.trim()).join("\n\n");
    return {
      files: [{ relativePath: "FAKE.md", content: body, strategy: { kind: "managed-region" } }],
      warnings: [],
    };
  },
};

describe("KataProject plan/apply", () => {
  it("plans and applies through injected adapters", async () => {
    const root = await makeTempDir("kata-engine-");
    await scaffold(root, {
      ".kata/config.yaml": "version: 1\ntargets:\n  fake-tool:\n    enabled: true\n",
      ".kata/instructions/base.md": "Do the thing.\n",
    });

    const project = await openProject(root, { adapters: [fakeAdapter] });
    const plan = await project.plan();
    expect(planHasChanges(plan)).toBe(true);
    expect(summarizePlan(plan)).toEqual({ creates: 1, updates: 0, unchanged: 0 });

    const diff = computeFileDiff(plan.targets[0]!.files[0]!);
    expect(diff.action).toBe("create");
    expect(diff.managedRegionOnly).toBe(true);
    expect(diff.hunks.length).toBeGreaterThan(0);

    await project.apply(plan);
    expect(await readFile(path.join(root, "FAKE.md"), "utf8")).toContain("Do the thing.");

    // Re-planning after apply reports no changes (drift check).
    const rePlan = await project.plan();
    expect(planHasChanges(rePlan)).toBe(false);
  });

  it("marks hand-edited content outside the managed region", async () => {
    const root = await makeTempDir("kata-engine-");
    await scaffold(root, {
      ".kata/config.yaml": "version: 1\ntargets:\n  fake-tool:\n    enabled: true\n",
      ".kata/instructions/base.md": "Do the thing.\n",
      "FAKE.md": "My hand-written notes.\n",
    });

    const project = await openProject(root, { adapters: [fakeAdapter] });
    const plan = await project.plan();
    const diff = computeFileDiff(plan.targets[0]!.files[0]!);
    expect(diff.action).toBe("update");
    // The merge only adds the managed region; hand edits survive.
    expect(diff.managedRegionOnly).toBe(true);

    await project.apply(plan);
    const merged = await readFile(path.join(root, "FAKE.md"), "utf8");
    expect(merged).toContain("My hand-written notes.");
    expect(merged).toContain("Do the thing.");
  });
});

describe("KataProject stageInstall", () => {
  async function snapshotTree(root: string): Promise<Map<string, string>> {
    const { listFilesRecursive } = await import("@katahq/core");
    const files = new Map<string, string>();
    for (const relativePath of await listFilesRecursive(root)) {
      files.set(relativePath, await readFile(path.join(root, relativePath), "utf8"));
    }
    return files;
  }

  it("cancel leaves the repo byte-identical", async () => {
    const root = await makeTempDir("kata-engine-");
    await scaffold(root, {
      ".kata/config.yaml": "version: 1\ntargets:\n  fake-tool:\n    enabled: true\n",
      ".kata/instructions/base.md": "Do the thing.\n",
    });
    const repoDir = await makePackageRepo({
      "kata-package.yaml": "name: team-standards\n",
      "instructions/50-team.md": "Team standard rules.\n",
    });
    const before = await snapshotTree(root);

    const project = await openProject(root, { adapters: [fakeAdapter] });
    const staged = await project.stageInstall({ kind: "git", url: `file://${repoDir}` });
    // The plan already reflects the staged package...
    expect(planHasChanges(staged.plan)).toBe(true);
    const planned = staged.plan.targets[0]!.files[0]!;
    expect(String(planned.newContent)).toContain("Team standard rules.");
    // ...but nothing on disk changed, and cancel keeps it that way.
    await staged.cancel();
    expect(await snapshotTree(root)).toEqual(before);
    await expect(staged.confirm()).rejects.toThrow(/already/);
  });

  it("confirm vendors the package, appends compose, and applies the plan", async () => {
    const root = await makeTempDir("kata-engine-");
    await scaffold(root, {
      ".kata/config.yaml": "version: 1\ntargets:\n  fake-tool:\n    enabled: true\n",
      ".kata/instructions/base.md": "Do the thing.\n",
    });
    const repoDir = await makePackageRepo({
      "kata-package.yaml": "name: team-standards\nversion: 2.0.0\n",
      "instructions/50-team.md": "Team standard rules.\n",
    });

    const project = await openProject(root, { adapters: [fakeAdapter] });
    const staged = await project.stageInstall({ kind: "git", url: `file://${repoDir}` });
    expect(staged.vendoredCommit).toMatch(/^[0-9a-f]{40}$/);

    const result = await staged.confirm();
    expect(result.install.addedToCompose).toBe(true);
    expect(result.apply.written.length).toBeGreaterThan(0);

    const config = await readFile(path.join(root, ".kata/config.yaml"), "utf8");
    expect(config).toContain(staged.composeRef);
    expect(await exists(staged.targetDir!)).toBe(true);
    expect(await exists(path.join(staged.targetDir!, ".kata-source.yaml"))).toBe(true);
    expect(await readFile(path.join(root, "FAKE.md"), "utf8")).toContain("Team standard rules.");

    // The project is coherent afterwards: no drift, package listed.
    expect(planHasChanges(await project.plan())).toBe(false);
    expect((await project.installedPackages()).map((pkg) => pkg.name)).toEqual(["team-standards"]);
    await expect(staged.cancel()).rejects.toThrow(/already/);
  });

  it("staging a repo that is not a package cleans up and throws", async () => {
    const root = await makeTempDir("kata-engine-");
    await scaffold(root, { ".kata/config.yaml": "version: 1\ntargets: {}\n" });
    const repoDir = await makePackageRepo({ "README.md": "not a package\n" });
    const before = await snapshotTree(root);

    const project = await openProject(root);
    await expect(project.stageInstall({ kind: "git", url: `file://${repoDir}` })).rejects.toThrow(
      /no kata-package.yaml/,
    );
    expect(await snapshotTree(root)).toEqual(before);
  });
});

describe("KataProject stageUninstall / stageUpdate", () => {
  it("stageUninstall plans the removal; confirm unwires and re-applies", async () => {
    const root = await makeTempDir("kata-engine-");
    await scaffold(root, {
      ".kata/config.yaml": "version: 1\ntargets:\n  fake-tool:\n    enabled: true\n",
      ".kata/instructions/base.md": "Do the thing.\n",
    });
    const repoDir = await makePackageRepo({
      "kata-package.yaml": "name: team-standards\n",
      "instructions/50-team.md": "Team standard rules.\n",
    });
    const project = await openProject(root, { adapters: [fakeAdapter] });
    await (await project.stageInstall({ kind: "git", url: `file://${repoDir}` })).confirm();
    expect(await readFile(path.join(root, "FAKE.md"), "utf8")).toContain("Team standard rules.");

    const staged = await project.stageUninstall("team-standards");
    expect(staged.willRemoveDir).toBe(true);
    // The plan reflects removal, but cancel keeps everything.
    const planned = staged.plan.targets[0]!.files[0]!;
    expect(String(planned.newContent)).not.toContain("Team standard rules.");
    await staged.cancel();
    expect(await readFile(path.join(root, "FAKE.md"), "utf8")).toContain("Team standard rules.");

    const second = await project.stageUninstall("team-standards");
    const result = await second.confirm();
    expect(result.uninstall.removedDir).toBe(true);
    expect(await exists(second.dir)).toBe(false);
    expect(await readFile(path.join(root, "FAKE.md"), "utf8")).not.toContain(
      "Team standard rules.",
    );
    expect(await project.installedPackages()).toEqual([]);
    expect(planHasChanges(await project.plan())).toBe(false);
  });

  it("stageUpdate re-vendors from the recorded source through the plan gate", async () => {
    const root = await makeTempDir("kata-engine-");
    await scaffold(root, {
      ".kata/config.yaml": "version: 1\ntargets:\n  fake-tool:\n    enabled: true\n",
    });
    const repoDir = await makePackageRepo({
      "kata-package.yaml": "name: team-standards\nversion: 1.0.0\n",
      "instructions/50-team.md": "Old rules.\n",
    });
    const project = await openProject(root, { adapters: [fakeAdapter] });
    const installed = await (
      await project.stageInstall({ kind: "git", url: `file://${repoDir}` })
    ).confirm();
    const previousCommit = installed.install.vendoredCommit;

    // Upstream moves on.
    await scaffold(repoDir, {
      "kata-package.yaml": "name: team-standards\nversion: 1.1.0\n",
      "instructions/50-team.md": "New rules.\n",
    });
    const git = (args: string[]) =>
      exec("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
        cwd: repoDir,
      });
    await git(["add", "-A"]);
    await git(["-c", "commit.gpgsign=false", "commit", "-qm", "update"]);

    const staged = await project.stageUpdate("team-standards");
    expect(staged.previousCommit).toBe(previousCommit);
    expect(staged.vendoredCommit).not.toBe(previousCommit);
    expect(staged.package.manifest.version).toBe("1.1.0");
    const planned = staged.plan.targets[0]!.files[0]!;
    expect(String(planned.newContent)).toContain("New rules.");

    const result = await staged.confirm();
    expect(result.install.addedToCompose).toBe(false);
    expect(await readFile(path.join(root, "FAKE.md"), "utf8")).toContain("New rules.");
    const packages = await project.installedPackages();
    expect(packages[0]?.version).toBe("1.1.0");
    expect(packages[0]?.vendoredCommit).toBe(staged.vendoredCommit);
  });

  it("stageUpdate refuses packages without a recorded git source", async () => {
    const root = await makeTempDir("kata-engine-");
    await scaffold(root, {
      ".kata/config.yaml": "version: 1\ntargets: {}\ncompose:\n  - ./shared/base-pkg\n",
      "shared/base-pkg/kata-package.yaml": "name: base-pkg\n",
    });
    const project = await openProject(root);
    await expect(project.stageUpdate("base-pkg")).rejects.toThrow(/cannot update/);
  });
});

describe("openProject / initProject", () => {
  it("openProject requires an existing config", async () => {
    const root = await makeTempDir("kata-engine-");
    await expect(openProject(root)).rejects.toThrow(/kata init/);
  });

  it("initProject scaffolds config.yaml with detected targets", async () => {
    const root = await makeTempDir("kata-engine-");
    const project = await initProject(root, { adapters: [fakeAdapter] });
    const config = await readFile(path.join(root, ".kata/config.yaml"), "utf8");
    expect(config).toContain("fake-tool");
    expect(config).toContain("enabled: true");
    expect((await project.load()).config.targets["fake-tool"]?.enabled).toBe(true);
  });
});
