/**
 * The shape of the registry's `index.json` (kata-registry, schemaVersion 1)
 * plus the cached view the bridge hands the renderer. The index is the
 * app's only remote dependency; everything needed to browse and inspect
 * bundles is pre-computed into it at registry build time.
 */

export interface RegistryPersona {
  slug: string;
  label: string;
  icon: string;
  blurb: string;
  /** Ordered bundle names curated for this persona. */
  curated: string[];
}

export interface RegistryMcpServer {
  name: string;
  transport: string;
  command?: string;
  args: string[];
  url?: string;
  /** Env var names the server references - names only, never values. */
  env: string[];
}

export interface RegistryBundleContents {
  instructions: string[];
  mcpServers: RegistryMcpServer[];
  prompts: string[];
  agents: string[];
  skills: string[];
}

export type RegistryBundleSource =
  | {
      kind: "git";
      url: string;
      ref: string;
      commit: string;
      /** Bundle directory inside the repo, for monorepos of bundles. */
      subdir?: string;
    }
  | { kind: "path"; path: string };

export interface RegistryBundle {
  name: string;
  version: string | null;
  description: string | null;
  source: RegistryBundleSource;
  personas: string[];
  tags: string[];
  targets: string[];
  contents: RegistryBundleContents;
  requires: { env: string[]; tools: string[] };
  homepage: string | null;
  license: string | null;
  authors: { name: string; url?: string }[];
  verified: boolean;
  featured: boolean;
  readme: string | null;
  iconDataUri: string | null;
}

export interface RegistryIndex {
  schemaVersion: number;
  generatedAt: string;
  personas: RegistryPersona[];
  bundles: RegistryBundle[];
}

/** A registry the user has configured. */
export interface RegistrySource {
  url: string;
  name: string | null;
}

/** Per-registry status inside a merged view. */
export interface RegistrySourceView {
  url: string;
  name: string | null;
  /** Fetch failed; the last cached copy is being served. */
  offline: boolean;
  /** Fetch failed and no cache exists - this source contributed nothing. */
  error: string | null;
  fetchedAt: string | null;
  bundleCount: number;
}

/**
 * The merged view over every configured registry. Bundles are deduped by
 * name (the first-listed registry wins) and carry their origin registry.
 */
export interface RegistryView {
  personas: RegistryPersona[];
  bundles: (RegistryBundle & { registryUrl: string })[];
  sources: RegistrySourceView[];
}
