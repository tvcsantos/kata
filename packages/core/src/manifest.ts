import { collectEnvRefs } from "./env-refs.js";
import { packageManifestSchema, type McpServer, type PackageManifest } from "./schema.js";

/**
 * Shared manifest validation for `kata-package.yaml`: the CLI, registry CI,
 * and desktop app all call `validateManifest()` so a manifest can never be
 * valid in one surface and invalid in another.
 *
 * Errors mean the manifest is unusable. Warnings are registry lints -
 * packages install fine with them, they just present poorly (or get
 * rejected by registry CI, which is free to treat warnings as fatal).
 */

export interface ManifestIssue {
  /** Dot path into the manifest, e.g. "requires.env[0]"; "" for the root. */
  path: string;
  message: string;
}

export interface ValidateManifestOptions {
  /** Canonical persona slugs; unknown slugs warn to prevent taxonomy drift. */
  knownPersonas?: string[];
  /** Known harness ids; unknown targets warn. */
  knownTargets?: string[];
}

export type ManifestValidation =
  | { ok: true; manifest: PackageManifest; warnings: ManifestIssue[] }
  | { ok: false; errors: ManifestIssue[]; warnings: ManifestIssue[] };

/** Longest description a registry card renders without truncating. */
export const MANIFEST_DESCRIPTION_MAX_LENGTH = 140;

const REGISTRY_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const SEMVER_REGEX =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function formatIssuePath(segments: PropertyKey[]): string {
  let formatted = "";
  for (const segment of segments) {
    if (typeof segment === "number") {
      formatted += `[${segment}]`;
    } else {
      formatted += formatted === "" ? String(segment) : `.${String(segment)}`;
    }
  }
  return formatted;
}

function collectWarnings(
  manifest: PackageManifest,
  options: ValidateManifestOptions,
): ManifestIssue[] {
  const warnings: ManifestIssue[] = [];
  if (!REGISTRY_NAME_REGEX.test(manifest.name)) {
    warnings.push({
      path: "name",
      message: `"${manifest.name}" is not lowercase kebab-case; registries require it`,
    });
  }
  if (manifest.version !== undefined && !SEMVER_REGEX.test(manifest.version)) {
    warnings.push({
      path: "version",
      message: `"${manifest.version}" is not semver; semver is recommended`,
    });
  }
  if (
    manifest.description !== undefined &&
    manifest.description.length > MANIFEST_DESCRIPTION_MAX_LENGTH
  ) {
    warnings.push({
      path: "description",
      message: `longer than ${MANIFEST_DESCRIPTION_MAX_LENGTH} characters; registry cards truncate it`,
    });
  }
  if (options.knownPersonas) {
    const known = new Set(options.knownPersonas);
    for (const [index, persona] of (manifest.personas ?? []).entries()) {
      if (!known.has(persona)) {
        warnings.push({
          path: `personas[${index}]`,
          message: `"${persona}" is not a canonical persona slug`,
        });
      }
    }
  }
  if (options.knownTargets) {
    const known = new Set(options.knownTargets);
    for (const [index, target] of (manifest.targets ?? []).entries()) {
      if (!known.has(target)) {
        warnings.push({
          path: `targets[${index}]`,
          message: `"${target}" is not a known target id`,
        });
      }
    }
  }
  return warnings;
}

/**
 * Validate a parsed `kata-package.yaml` (the caller parses the YAML).
 * Never throws: schema violations come back as `errors`, registry lints
 * (non-kebab name, non-semver version, over-long description, unknown
 * persona/target slugs) as `warnings`.
 */
export function validateManifest(
  raw: unknown,
  options: ValidateManifestOptions = {},
): ManifestValidation {
  const result = packageManifestSchema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.issues.map((issue) => ({
      path: formatIssuePath(issue.path),
      message: issue.message,
    }));
    return { ok: false, errors, warnings: [] };
  }
  const manifest = result.data;
  return { ok: true, manifest, warnings: collectWarnings(manifest, options) };
}

/**
 * The env vars a package's MCP servers reference via `${env:VAR}` - the
 * derivable part of `requires.env`. Authors may declare more (vars kata
 * cannot see); a registry merges this with the manifest's explicit list.
 */
export function deriveRequiredEnv(mcpServers: Record<string, McpServer>): string[] {
  const vars = new Set<string>();
  for (const server of Object.values(mcpServers)) {
    const values = [
      server.command ?? "",
      server.url ?? "",
      ...server.args,
      ...Object.values(server.env),
      ...Object.values(server.headers),
    ];
    for (const value of values) {
      for (const varName of collectEnvRefs(value)) vars.add(varName);
    }
  }
  return [...vars].sort((a, b) => a.localeCompare(b));
}
