export {
  configSchema,
  targetConfigSchema,
  mcpServerSchema,
  mcpServersFileSchema,
  packageManifestSchema,
  packageAuthorSchema,
  packageRequiresSchema,
  type KataConfig,
  type TargetConfig,
  type McpServer,
  type McpServersFile,
  type PackageManifest,
  type PackageAuthor,
  type PackageRequires,
  CONFIG_SCHEMA_VERSION,
  MCP_SERVERS_SCHEMA_VERSION,
} from "./schema.js";

export {
  validateManifest,
  deriveRequiredEnv,
  MANIFEST_DESCRIPTION_MAX_LENGTH,
  type ManifestIssue,
  type ManifestValidation,
  type ValidateManifestOptions,
} from "./manifest.js";

export {
  CONFIG_DIR_NAME,
  CONFIG_FILE_NAME,
  PACKAGE_MANIFEST_NAME,
  PACKAGES_DIR_NAME,
  SKILL_MD_NAME,
  emptyArtifacts,
  findProjectRoot,
  loadArtifactsFromDir,
  loadPackage,
  loadProject,
  makeLocalComposeRef,
  mergeArtifacts,
  readSkillDirs,
  resolvePackageDir,
  makeInstructionsDirPath,
  makeInstructionPath,
  makePromptsDirPath,
  makePromptPath,
  makeAgentsDirPath,
  makeAgentPath,
  makeSkillDirPath,
  makeSkillPath,
  makeMcpDirPath,
  makeInstructionRelativePath,
  makePromptRelativePath,
  makeAgentRelativePath,
  makeSkillDirRelativePath,
  makeSkillRelativePath,
  makeMcpServerPath,
  makeConfigDirPath,
  makeConfigPath,
  makeConfigPathFromRoot,
  makeNodeModulesDirPath,
  getRootDir,
  type Project,
  type InstructionFile,
  type LoadedPackage,
  type ProjectArtifacts,
  type PromptFile,
  type Skill,
  type SkillFile,
  type SubagentFile,
} from "./project.js";

export {
  AdapterRegistry,
  emptyImportResult,
  type Adapter,
  type AdapterContext,
  type AdapterWarning,
  type ArtifactType,
  type EmitResult,
  type EmittedFile,
  type Fidelity,
  type ImportResult,
  type Scope,
  type WriteStrategy,
} from "./adapter.js";

export {
  exists,
  listFilesRecursive,
  readNamedMarkdownFiles,
  readTextFileOrDefault,
  readTextFileOrNull,
  toPosixPath,
  type NamedMarkdownFile,
} from "./fs.js";

export { parseFrontmatter, stripFrontmatter, type Frontmatter } from "./frontmatter.js";

export {
  REGION_BEGIN,
  REGION_END,
  mergeManagedRegion,
  removeManagedRegion,
  deepMerge,
  mergeJsonFragment,
  mergeTomlFragment,
  stableJson,
  resolveContent,
} from "./strategies.js";

export {
  displayAbsolutePath,
  displayPath,
  planAll,
  planTarget,
  planHasChanges,
  type Plan,
  type PlanAction,
  type PlannedFile,
  type TargetPlan,
} from "./plan.js";

export { applyPlan, type ApplyResult } from "./apply.js";

export {
  computeFileDiff,
  summarizePlan,
  type DiffHunk,
  type FileDiff,
  type PlanSummary,
} from "./diff.js";

export {
  initProject,
  KataProject,
  makeAdapterContext,
  makeStandaloneContext,
  openProject,
  parsePackageSource,
  selectEnabledAdapters,
  slugFromGitUrl,
  systemGitClone,
  type EngineOptions,
  type GitClone,
  type InstalledPackage,
  type InstallOptions,
  type InstallProgress,
  type InstallResult,
  type PackageSource,
  type PlanOptions,
  type StagedInstall,
  type StagedInstallResult,
  type StagedUninstall,
  type StagedUninstallResult,
  type StagedUpdate,
  type UninstallResult,
} from "./engine.js";

export { renderEnvRefs, collectEnvRefs, pureEnvRef } from "./env-refs.js";
