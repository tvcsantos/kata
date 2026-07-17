import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  computeFileDiff,
  displayPath,
  initProject,
  openProject,
  summarizePlan,
  type Adapter,
  type ApplyResult,
  type KataProject,
  type PackageSource,
  type Plan,
} from "@katahq/core";
import claudeCodeAdapter from "@katahq/adapter-claude-code";
import codexAdapter from "@katahq/adapter-codex";
import copilotAdapter from "@katahq/adapter-copilot";
import cursorAdapter from "@katahq/adapter-cursor";
import geminiAdapter from "@katahq/adapter-gemini";
import opencodeAdapter from "@katahq/adapter-opencode";
import vscodeAdapter from "@katahq/adapter-vscode";
import type {
  ChangeKind,
  ChangeOutcome,
  ChangePreview,
  InstalledPackageView,
  ProjectInfo,
  TargetDiffView,
} from "../shared/bridge";
import type { RegistryBundle } from "../shared/registry";

export const builtinAdapters: Adapter[] = [
  claudeCodeAdapter,
  codexAdapter,
  copilotAdapter,
  cursorAdapter,
  geminiAdapter,
  opencodeAdapter,
  vscodeAdapter,
];

function toSourceView(source: PackageSource | undefined): {
  sourceKind: InstalledPackageView["sourceKind"];
  sourceUrl: string | null;
} {
  if (!source) return { sourceKind: "unknown", sourceUrl: null };
  switch (source.kind) {
    case "git":
      return { sourceKind: "git", sourceUrl: source.url };
    case "npm":
      return { sourceKind: "npm", sourceUrl: source.packageName };
    case "path":
      return { sourceKind: "path", sourceUrl: source.path };
  }
}

/**
 * Wraps the @katahq/core engine for the main process: holds the
 * projectId -> KataProject map so the renderer only ever handles opaque ids.
 */
interface PendingChange {
  kind: ChangeKind;
  bundleName: string | null;
  requiresEnv: string[];
  confirm: () => Promise<ApplyResult>;
  cancel: () => Promise<void>;
}

function toTargetViews(plan: Plan): TargetDiffView[] {
  return plan.targets.map((target) => ({
    target: target.target,
    detected: target.detected,
    files: target.files.map(computeFileDiff),
    warnings: target.warnings.map((warning) => ({ message: warning.message })),
  }));
}

export class EngineService {
  private readonly projects = new Map<string, KataProject>();
  private readonly pendingChanges = new Map<string, PendingChange>();

  async open(dir: string): Promise<ProjectInfo> {
    const project = await openProject(dir, { adapters: builtinAdapters });
    return this.register(project);
  }

  async init(dir: string): Promise<ProjectInfo> {
    const project = await initProject(dir, { adapters: builtinAdapters });
    return this.register(project);
  }

  get(projectId: string): KataProject {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Unknown project id "${projectId}" - reopen the project.`);
    }
    return project;
  }

  /** Stage a bundle install: fetch + plan, write nothing. */
  async stageBundleInstall(
    projectId: string,
    bundle: RegistryBundle,
    source: PackageSource,
  ): Promise<ChangePreview> {
    const project = this.get(projectId);
    const staged = await project.stageInstall(source, { name: bundle.name });
    return this.registerChange({
      kind: "install",
      bundleName: bundle.name,
      version: bundle.version,
      composeRef: staged.composeRef,
      plan: staged.plan,
      requiresEnv: bundle.requires.env,
      requiresTools: bundle.requires.tools,
      confirm: async () => (await staged.confirm()).apply,
      cancel: () => staged.cancel(),
    });
  }

  async stageBundleUninstall(projectId: string, bundleName: string): Promise<ChangePreview> {
    const staged = await this.get(projectId).stageUninstall(bundleName);
    return this.registerChange({
      kind: "uninstall",
      bundleName,
      version: null,
      composeRef: staged.composeRef,
      plan: staged.plan,
      requiresEnv: [],
      requiresTools: [],
      confirm: async () => (await staged.confirm()).apply,
      cancel: () => staged.cancel(),
    });
  }

  async stageBundleUpdate(projectId: string, bundleName: string): Promise<ChangePreview> {
    const staged = await this.get(projectId).stageUpdate(bundleName);
    return this.registerChange({
      kind: "update",
      bundleName,
      version: staged.package.manifest.version ?? null,
      composeRef: staged.composeRef,
      plan: staged.plan,
      requiresEnv: staged.package.manifest.requires?.env ?? [],
      requiresTools: staged.package.manifest.requires?.tools ?? [],
      confirm: async () => (await staged.confirm()).apply,
      cancel: () => staged.cancel(),
    });
  }

  /** The current plan (drift) as a confirmable re-apply change. */
  async stageReapply(projectId: string): Promise<ChangePreview> {
    const project = this.get(projectId);
    const plan = await project.plan();
    return this.registerChange({
      kind: "reapply",
      bundleName: null,
      version: null,
      composeRef: null,
      plan,
      requiresEnv: [],
      requiresTools: [],
      confirm: () => project.apply(plan),
      cancel: async () => {},
    });
  }

  async confirmChange(changeId: string): Promise<ChangeOutcome> {
    const pending = this.takePendingChange(changeId);
    const apply = await pending.confirm();
    return {
      kind: pending.kind,
      bundleName: pending.bundleName,
      writtenFiles: apply.written.map((file) => displayPath(file.relativePath, file.scope)),
      requiresEnv: pending.requiresEnv,
    };
  }

  async cancelChange(changeId: string): Promise<void> {
    await this.takePendingChange(changeId).cancel();
  }

  private registerChange(change: {
    kind: ChangeKind;
    bundleName: string | null;
    version: string | null;
    composeRef: string | null;
    plan: Plan;
    requiresEnv: string[];
    requiresTools: string[];
    confirm: () => Promise<ApplyResult>;
    cancel: () => Promise<void>;
  }): ChangePreview {
    const changeId = randomUUID();
    this.pendingChanges.set(changeId, {
      kind: change.kind,
      bundleName: change.bundleName,
      requiresEnv: change.requiresEnv,
      confirm: change.confirm,
      cancel: change.cancel,
    });
    return {
      changeId,
      kind: change.kind,
      bundleName: change.bundleName,
      version: change.version,
      composeRef: change.composeRef,
      targets: toTargetViews(change.plan),
      summary: summarizePlan(change.plan),
      requiresEnv: change.requiresEnv,
      requiresTools: change.requiresTools,
    };
  }

  private takePendingChange(changeId: string): PendingChange {
    const pending = this.pendingChanges.get(changeId);
    if (!pending) {
      throw new Error(`Unknown change id "${changeId}" - stage the change again.`);
    }
    this.pendingChanges.delete(changeId);
    return pending;
  }

  private async register(project: KataProject): Promise<ProjectInfo> {
    const projectId = randomUUID();
    this.projects.set(projectId, project);
    return this.describe(projectId, project);
  }

  private async describe(projectId: string, project: KataProject): Promise<ProjectInfo> {
    const loaded = await project.load();
    const packages = await project.installedPackages();
    const planSummary = summarizePlan(await project.plan());
    return {
      pendingChanges: planSummary.creates + planSummary.updates,
      projectId,
      dir: project.rootDir,
      name: path.basename(project.rootDir),
      targets: Object.entries(loaded.config.targets).map(([id, target]) => ({
        id,
        enabled: target.enabled,
      })),
      packages: packages.map((pkg) => ({
        name: pkg.name,
        version: pkg.version ?? null,
        composeRef: pkg.composeRef,
        vendoredCommit: pkg.vendoredCommit ?? null,
        ...toSourceView(pkg.source),
      })),
      artifacts: {
        instructions: loaded.instructions.length,
        mcpServers: Object.keys(loaded.mcpServers).length,
        prompts: loaded.prompts.length,
        agents: loaded.agents.length,
        skills: loaded.skills.length,
      },
    };
  }
}
