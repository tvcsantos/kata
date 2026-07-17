import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PackageSource } from "@katahq/core";
import type { RegistryBundle, RegistryIndex } from "../shared/registry";

export const DEFAULT_REGISTRY_URL = "https://tvcsantos.github.io/kata-registry/index.json";

/** Serve the cache without a network round-trip when younger than this. */
const CACHE_FRESH_MS = 15 * 60 * 1000;

interface RegistryCache {
  sourceUrl: string;
  fetchedAt: string;
  etag: string | null;
  index: RegistryIndex;
}

function assertIndexShape(parsed: unknown): RegistryIndex {
  const index = parsed as RegistryIndex;
  if (
    typeof index !== "object" ||
    index === null ||
    index.schemaVersion !== 1 ||
    !Array.isArray(index.personas) ||
    !Array.isArray(index.bundles)
  ) {
    throw new Error("Registry index has an unexpected shape (want schemaVersion 1).");
  }
  return index;
}

/** One registry's fetch result, as consumed by the merging RegistryManager. */
export interface RegistryFetch {
  index: RegistryIndex;
  fetchedAt: string;
  /** True when the network failed and this is the last cached copy. */
  offline: boolean;
}

/**
 * Fetches and caches one registry index (cache file keyed by URL). The
 * renderer never touches the network - this runs main-side and the bridge
 * hands over plain data. Offline (or on any fetch failure) the last cached
 * copy is served, flagged `offline: true`.
 *
 * `sourceUrl` supports `file://` for local registry development
 * (KATA_REGISTRY_URL=file:///path/to/kata-registry/dist/index.json).
 */
export class RegistryService {
  private readonly cachePath: string;

  constructor(
    cacheDir: string,
    readonly sourceUrl: string = DEFAULT_REGISTRY_URL,
  ) {
    const key = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 12);
    this.cachePath = path.join(cacheDir, `registry-cache-${key}.json`);
  }

  async get(options: { refresh?: boolean } = {}): Promise<RegistryFetch> {
    const cache = await this.readCache();
    // file:// registries are local dev checkouts - re-read every time so a
    // rebuilt index shows up immediately; the cache only serves http(s).
    const cacheIsFresh =
      cache !== null &&
      !this.sourceUrl.startsWith("file://") &&
      Date.now() - Date.parse(cache.fetchedAt) < CACHE_FRESH_MS;
    if (cache && cacheIsFresh && !options.refresh) {
      return this.view(cache, false);
    }

    try {
      const fetched = await this.fetchIndex(cache?.etag ?? null);
      if (fetched === "not-modified" && cache) {
        const refreshed: RegistryCache = { ...cache, fetchedAt: new Date().toISOString() };
        await this.writeCache(refreshed);
        return this.view(refreshed, false);
      }
      if (fetched !== "not-modified") {
        const next: RegistryCache = {
          sourceUrl: this.sourceUrl,
          fetchedAt: new Date().toISOString(),
          etag: fetched.etag,
          index: fetched.index,
        };
        await this.writeCache(next);
        return this.view(next, false);
      }
      // not-modified without a cache should be impossible; refetch fully.
      throw new Error("Registry returned 304 without a local cache.");
    } catch (err) {
      if (cache) return this.view(cache, true);
      throw new Error(
        `Could not fetch the registry from ${this.sourceUrl} and no cached copy exists: ${(err as Error).message}`,
        { cause: err },
      );
    }
  }

  /**
   * The engine PackageSource for a registry bundle. Git bundles install
   * from their repo URL. Registry-local `path` bundles (first-party seeds)
   * are only reachable when the registry itself is a local `file://`
   * checkout - the path is resolved against the registry root (index.json
   * lives in its `dist/`).
   */
  resolveInstallSource(bundle: RegistryBundle): PackageSource {
    if (bundle.source.kind === "git") {
      return { kind: "git", url: bundle.source.url };
    }
    if (this.sourceUrl.startsWith("file://")) {
      const registryRoot = path.dirname(path.dirname(fileURLToPath(this.sourceUrl)));
      return { kind: "path", path: path.resolve(registryRoot, bundle.source.path) };
    }
    throw new Error(
      `Bundle "${bundle.name}" has no installable source in this registry yet (registry-local path).`,
    );
  }

  private view(cache: RegistryCache, offline: boolean): RegistryFetch {
    return {
      index: cache.index,
      fetchedAt: cache.fetchedAt,
      offline,
    };
  }

  private async fetchIndex(
    etag: string | null,
  ): Promise<{ index: RegistryIndex; etag: string | null } | "not-modified"> {
    if (this.sourceUrl.startsWith("file://")) {
      const raw = await readFile(fileURLToPath(this.sourceUrl), "utf8");
      return { index: assertIndexShape(JSON.parse(raw)), etag: null };
    }
    const headers: Record<string, string> = { accept: "application/json" };
    if (etag) headers["if-none-match"] = etag;
    const response = await fetch(this.sourceUrl, { headers });
    if (response.status === 304) return "not-modified";
    if (!response.ok) {
      throw new Error(`Registry fetch failed: HTTP ${response.status}`);
    }
    return {
      index: assertIndexShape(await response.json()),
      etag: response.headers.get("etag"),
    };
  }

  private async readCache(): Promise<RegistryCache | null> {
    let raw: string;
    try {
      raw = await readFile(this.cachePath, "utf8");
    } catch {
      return null;
    }
    try {
      const cache = JSON.parse(raw) as RegistryCache;
      assertIndexShape(cache.index);
      // A cache from a different registry URL must not be served.
      return cache.sourceUrl === this.sourceUrl ? cache : null;
    } catch {
      return null;
    }
  }

  private async writeCache(cache: RegistryCache): Promise<void> {
    await mkdir(path.dirname(this.cachePath), { recursive: true });
    await writeFile(this.cachePath, JSON.stringify(cache), "utf8");
  }
}
