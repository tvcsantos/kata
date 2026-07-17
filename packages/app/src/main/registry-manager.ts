import type { PackageSource } from "@katahq/core";
import type {
  RegistryBundle,
  RegistryPersona,
  RegistrySource,
  RegistrySourceView,
  RegistryView,
} from "../shared/registry";
import type { PreferencesStore } from "./preferences-store";
import { RegistryService } from "./registry-service";

/**
 * The merged view over every configured registry. Each registry fetches
 * (and caches) independently; a broken one degrades to its cache or an
 * error entry in `sources` without taking the rest down. Bundles are
 * deduped by name - the first-listed registry wins - and carry their
 * origin so installs resolve against the right registry.
 */
export class RegistryManager {
  private readonly services = new Map<string, RegistryService>();

  constructor(
    private readonly cacheDir: string,
    private readonly preferences: PreferencesStore,
  ) {}

  sources(): Promise<RegistrySource[]> {
    return this.preferences.registries();
  }

  async get(options: { refresh?: boolean } = {}): Promise<RegistryView> {
    const sources = await this.sources();
    const fetches = await Promise.allSettled(
      sources.map((source) => this.serviceFor(source.url).get(options)),
    );

    const personas: RegistryPersona[] = [];
    const seenPersonas = new Set<string>();
    const bundles: (RegistryBundle & { registryUrl: string })[] = [];
    const seenBundles = new Set<string>();
    const sourceViews: RegistrySourceView[] = [];

    for (const [index, source] of sources.entries()) {
      const fetch = fetches[index]!;
      if (fetch.status === "rejected") {
        sourceViews.push({
          url: source.url,
          name: source.name,
          offline: false,
          error: (fetch.reason as Error).message,
          fetchedAt: null,
          bundleCount: 0,
        });
        continue;
      }
      let contributed = 0;
      for (const persona of fetch.value.index.personas) {
        if (seenPersonas.has(persona.slug)) continue;
        seenPersonas.add(persona.slug);
        personas.push(persona);
      }
      for (const bundle of fetch.value.index.bundles) {
        if (seenBundles.has(bundle.name)) continue;
        seenBundles.add(bundle.name);
        bundles.push({ ...bundle, registryUrl: source.url });
        contributed += 1;
      }
      sourceViews.push({
        url: source.url,
        name: source.name,
        offline: fetch.value.offline,
        error: null,
        fetchedAt: fetch.value.fetchedAt,
        bundleCount: contributed,
      });
    }

    return { personas, bundles, sources: sourceViews };
  }

  resolveInstallSource(bundle: RegistryBundle & { registryUrl: string }): PackageSource {
    return this.serviceFor(bundle.registryUrl).resolveInstallSource(bundle);
  }

  private serviceFor(url: string): RegistryService {
    let service = this.services.get(url);
    if (!service) {
      service = new RegistryService(this.cacheDir, url);
      this.services.set(url, service);
    }
    return service;
  }
}
