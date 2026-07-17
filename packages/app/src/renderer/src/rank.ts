import type { RegistryBundle, RegistryPersona } from "../../shared/registry";

/**
 * Suggestion ranking, deterministic and explainable (the UI shows `reason`
 * verbatim). Weight order, per PLAN_APP.md §9: curated pick for a selected
 * persona, then persona-field match, then tag overlap with already-installed
 * bundles, then featured. Recency is deferred until the index carries
 * timestamps.
 */

export interface Suggestion {
  bundle: RegistryBundle;
  /** Why this bundle ranks where it does; null for unranked entries. */
  reason: string | null;
}

const CURATED_SCORE = 4000;
const PERSONA_MATCH_SCORE = 3000;
const TAG_OVERLAP_SCORE = 2000;
const FEATURED_SCORE = 1000;

export function rankBundles(options: {
  bundles: RegistryBundle[];
  personas: RegistryPersona[];
  selectedPersonas: string[];
  /** Names of bundles already installed in the active project. */
  installedBundleNames: string[];
}): Suggestion[] {
  const personasBySlug = new Map(options.personas.map((persona) => [persona.slug, persona]));
  const selected = options.selectedPersonas
    .map((slug) => personasBySlug.get(slug))
    .filter((persona): persona is RegistryPersona => persona !== undefined);

  const installed = new Set(options.installedBundleNames);
  const installedTags = new Set(
    options.bundles.filter((bundle) => installed.has(bundle.name)).flatMap((bundle) => bundle.tags),
  );

  function scoreOf(bundle: RegistryBundle): { score: number; reason: string | null } {
    for (const [personaIndex, persona] of selected.entries()) {
      const curatedIndex = persona.curated.indexOf(bundle.name);
      if (curatedIndex !== -1) {
        return {
          score: CURATED_SCORE - personaIndex * 100 - curatedIndex,
          reason: `Curated for ${persona.label}`,
        };
      }
    }
    for (const persona of selected) {
      if (bundle.personas.includes(persona.slug)) {
        return { score: PERSONA_MATCH_SCORE, reason: `Recommended for ${persona.label}` };
      }
    }
    if (!installed.has(bundle.name)) {
      const overlap = bundle.tags.filter((tag) => installedTags.has(tag)).length;
      if (overlap > 0) {
        return {
          score: TAG_OVERLAP_SCORE + overlap,
          reason: "Similar to bundles in your project",
        };
      }
    }
    if (bundle.featured) {
      return { score: FEATURED_SCORE, reason: "Featured" };
    }
    return { score: 0, reason: null };
  }

  return options.bundles
    .map((bundle) => ({ bundle, ...scoreOf(bundle) }))
    .sort((a, b) => b.score - a.score || a.bundle.name.localeCompare(b.bundle.name))
    .map(({ bundle, reason }) => ({ bundle, reason }));
}
