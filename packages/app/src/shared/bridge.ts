import type { FileDiff, PlanSummary } from "@katahq/core";
import type { RegistrySource, RegistryView } from "./registry";

/**
 * The typed IPC contract - the only surface the renderer sees. The renderer
 * is sandboxed (no Node, no fs, no network); everything crosses this bridge
 * as plain serializable data, and the main process resolves projectIds to
 * real directories in its own map, so the renderer never drives filesystem
 * paths directly.
 */

export interface InstalledPackageView {
  name: string;
  version: string | null;
  composeRef: string;
  sourceKind: "git" | "npm" | "path" | "unknown";
  sourceUrl: string | null;
  vendoredCommit: string | null;
}

export interface TargetView {
  id: string;
  enabled: boolean;
}

export interface ArtifactCounts {
  instructions: number;
  mcpServers: number;
  prompts: number;
  agents: number;
  skills: number;
}

export interface ProjectInfo {
  /** Opaque handle for follow-up calls; only valid in this app session. */
  projectId: string;
  /** Shown to the user; never fed back into bridge calls. */
  dir: string;
  name: string;
  targets: TargetView[];
  packages: InstalledPackageView[];
  artifacts: ArtifactCounts;
  /** Files a `plan` would create or update right now - drift when > 0. */
  pendingChanges: number;
}

export interface RecentProject {
  dir: string;
  name: string;
  lastOpenedAt: string;
}

export interface AppVersions {
  app: string;
  core: string | null;
  electron: string;
}

export interface TargetDiffView {
  target: string;
  detected: boolean;
  files: FileDiff[];
  warnings: { message: string }[];
}

export type ChangeKind = "install" | "uninstall" | "update" | "reapply";

/**
 * A staged change awaiting the user's decision - nothing written yet.
 * Every mutating flow (install, uninstall, update, drift re-apply) goes
 * through this same plan-preview gate.
 */
export interface ChangePreview {
  changeId: string;
  kind: ChangeKind;
  /** The bundle involved; null for a whole-project re-apply. */
  bundleName: string | null;
  version: string | null;
  composeRef: string | null;
  targets: TargetDiffView[];
  summary: PlanSummary;
  requiresEnv: string[];
  requiresTools: string[];
}

export interface ChangeOutcome {
  kind: ChangeKind;
  bundleName: string | null;
  /** Display paths of every file written by the apply. */
  writtenFiles: string[];
  requiresEnv: string[];
}

/**
 * App self-update state. `mode` distinguishes the two tiers: "auto" (Windows
 * and Linux) downloads in-app and installs on restart; "manual" (macOS,
 * which can't self-update unsigned) points the user at the download page.
 */
export type UpdateState =
  | { status: "unsupported" } // dev build or platform without a channel
  | { status: "idle" }
  | { status: "checking" }
  | { status: "not-available" }
  | { status: "available"; version: string; mode: "auto" | "manual" }
  | { status: "downloading"; version: string; percent: number }
  | { status: "downloaded"; version: string }
  | { status: "error"; message: string };

export type Unsubscribe = () => void;

export interface KataBridge {
  /** Native folder dialog (main-side); null when the user cancels. */
  pickProjectFolder(): Promise<string | null>;
  /** Open an existing kata project; rejects if `.kata/config.yaml` is missing. */
  openProject(dir: string): Promise<ProjectInfo>;
  /** Scaffold a minimal `.kata/` (detecting installed tools) and open it. */
  initProject(dir: string): Promise<ProjectInfo>;
  recentProjects(): Promise<RecentProject[]>;
  versions(): Promise<AppVersions>;
  /** The merged view over all registries; `refresh` forces round-trips. */
  getRegistry(options?: { refresh?: boolean }): Promise<RegistryView>;

  // Registry management: user-configured sources, in priority order.
  getRegistries(): Promise<RegistrySource[]>;
  /** The official registry, offered during first-run setup. */
  getSuggestedRegistry(): Promise<{ url: string; name: string }>;
  addRegistry(url: string, name: string | null): Promise<void>;
  removeRegistry(url: string): Promise<void>;

  // Change lifecycle - always plan-before-apply, no exceptions. Each stage
  // call computes the diff without writing; only confirmChange touches the
  // project, and cancelChange leaves it byte-identical.
  installBundle(projectId: string, bundleName: string): Promise<ChangePreview>;
  uninstallBundle(projectId: string, bundleName: string): Promise<ChangePreview>;
  updateBundle(projectId: string, bundleName: string): Promise<ChangePreview>;
  /** Drift check / re-apply: the current plan as a confirmable change. */
  planProject(projectId: string): Promise<ChangePreview>;
  confirmChange(changeId: string): Promise<ChangeOutcome>;
  cancelChange(changeId: string): Promise<void>;

  /** Persona slugs chosen at onboarding; null means never asked yet. */
  getPersonas(): Promise<string[] | null>;
  setPersonas(slugs: string[]): Promise<void>;

  // Appearance: follow the system or force light/dark.
  getTheme(): Promise<"system" | "light" | "dark">;
  setTheme(theme: "system" | "light" | "dark"): Promise<void>;

  // App self-update (two-tier: auto on Windows/Linux, notify on macOS).
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<void>;
  /** auto: restart into the new version; manual: open the download page. */
  installUpdate(): Promise<void>;
  onUpdateState(callback: (state: UpdateState) => void): Unsubscribe;
}
