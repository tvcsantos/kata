import { useEffect, useMemo, useRef, useState } from "react";
import type { RegistryBundle, RegistryView } from "../../../shared/registry";
import { rankBundles, type Suggestion } from "../rank";

/** Active-filter chips stay on one row; the rest collapse into "+N". */
const MAX_VISIBLE_PERSONA_CHIPS = 3;

function matchesQuery(bundle: RegistryBundle, query: string): boolean {
  if (query === "") return true;
  const haystack = [
    bundle.name,
    bundle.description ?? "",
    ...bundle.tags,
    ...bundle.personas,
    ...bundle.targets,
  ]
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((term) => haystack.includes(term));
}

function BundleCard(props: {
  suggestion: Suggestion;
  onSelect: (bundle: RegistryBundle) => void;
}): React.JSX.Element {
  const { bundle, reason } = props.suggestion;
  return (
    <button className="card" onClick={() => props.onSelect(bundle)}>
      <div className="card-head">
        {bundle.iconDataUri ? (
          <img className="card-icon" src={bundle.iconDataUri} alt="" />
        ) : (
          <span className="card-icon placeholder">{bundle.name.slice(0, 2)}</span>
        )}
        <span className="name">{bundle.name}</span>
        {bundle.verified && (
          <span className="verified-icon" title="Verified - reviewed by registry maintainers">
            ✓
          </span>
        )}
      </div>
      <p>{bundle.description ?? ""}</p>
      {reason && <span className="reason">{reason}</span>}
      <div className="chips">
        {bundle.personas.map((persona) => (
          <span key={persona} className="chip">
            {persona}
          </span>
        ))}
      </div>
    </button>
  );
}

export function BrowseScreen(props: {
  view: RegistryView;
  activePersonas: string[];
  onTogglePersona: (slug: string) => void;
  onSetPersonas: (slugs: string[]) => void;
  onSelect: (bundle: RegistryBundle) => void;
  onRefresh: () => void;
  onRegistries: () => void;
  onWorkProfile: () => void;
  onAbout: () => void;
}): React.JSX.Element {
  const { view } = props;
  const [query, setQuery] = useState("");
  const [personaQuery, setPersonaQuery] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const personaDropdown = useRef<HTMLDetailsElement>(null);
  const personaSearch = useRef<HTMLInputElement>(null);

  // Close the personas dropdown on any click outside it (and on Escape).
  useEffect(() => {
    function closeIfOutside(event: MouseEvent): void {
      const dropdown = personaDropdown.current;
      if (dropdown?.open && event.target instanceof Node && !dropdown.contains(event.target)) {
        dropdown.open = false;
      }
    }
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape" && personaDropdown.current?.open) {
        personaDropdown.current.open = false;
      }
    }
    document.addEventListener("pointerdown", closeIfOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const visiblePersonas = view.personas.filter((persona) => {
    if (personaQuery === "") return true;
    const haystack = `${persona.label} ${persona.slug} ${persona.blurb}`.toLowerCase();
    return haystack.includes(personaQuery.toLowerCase());
  });

  /** Select all acts on the filtered list; deselect clears everything. */
  function selectAllVisible(): void {
    const slugs = new Set([...props.activePersonas, ...visiblePersonas.map((p) => p.slug)]);
    props.onSetPersonas([...slugs]);
  }

  const suggestions = useMemo(() => {
    const ranked = rankBundles({
      bundles: view.bundles,
      personas: view.personas,
      selectedPersonas: props.activePersonas,
      installedBundleNames: [],
    });
    return ranked.filter(({ bundle }) => {
      if (verifiedOnly && !bundle.verified) return false;
      return matchesQuery(bundle, query);
    });
  }, [view, query, verifiedOnly, props.activePersonas]);

  const activePersonaEntries = view.personas.filter((persona) =>
    props.activePersonas.includes(persona.slug),
  );

  const degradedSources = view.sources.filter((source) => source.offline || source.error);

  return (
    <section className="browse">
      <div className="screen-head">
        <h1>Bundles</h1>
        <div className="screen-head-actions">
          <button title="Refresh the registries" onClick={props.onRefresh}>
            ↻ Refresh
          </button>
          <button title="Manage registries" onClick={props.onRegistries}>
            Registries
          </button>
          <button title="Change what kind of work you do" onClick={props.onWorkProfile}>
            Type of work
          </button>
          <button title="About kata" onClick={props.onAbout}>
            About
          </button>
        </div>
      </div>
      {degradedSources.length > 0 && (
        <div className="notice">
          <p>
            {degradedSources
              .map((source) =>
                source.error
                  ? `${source.name ?? source.url} is unreachable`
                  : `${source.name ?? source.url} is offline (cached copy shown)`,
              )
              .join("; ")}
            . <button onClick={props.onRefresh}>Retry</button>
          </p>
        </div>
      )}

      <div className="filters">
        <input
          type="search"
          placeholder="Search bundles…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <details
          className="dropdown"
          ref={personaDropdown}
          onToggle={(event) => {
            // Type-to-search immediately: focus the field on open.
            if (event.currentTarget.open) personaSearch.current?.focus();
          }}
        >
          <summary>
            Personas
            {props.activePersonas.length > 0 ? ` (${props.activePersonas.length})` : ""}
          </summary>
          <div className="dropdown-menu">
            <input
              ref={personaSearch}
              type="search"
              className="dropdown-search"
              placeholder="Filter personas…"
              value={personaQuery}
              onChange={(event) => setPersonaQuery(event.target.value)}
            />
            <div className="dropdown-bulk">
              <button onClick={selectAllVisible}>Select all</button>
              <button onClick={() => props.onSetPersonas([])}>Deselect all</button>
            </div>
            {visiblePersonas.length === 0 && <span className="empty">No matches.</span>}
            {visiblePersonas.map((persona) => (
              <label key={persona.slug} className="dropdown-item" title={persona.blurb}>
                <input
                  type="checkbox"
                  checked={props.activePersonas.includes(persona.slug)}
                  onChange={() => props.onTogglePersona(persona.slug)}
                />
                {persona.label}
              </label>
            ))}
          </div>
        </details>
        <label className="toggle">
          <input
            type="checkbox"
            checked={verifiedOnly}
            onChange={(event) => setVerifiedOnly(event.target.checked)}
          />
          Verified only
        </label>
      </div>

      {/* Always rendered at a fixed height so toggling filters never
          shifts the layout; overflow collapses into a "+N" chip. */}
      <div className="active-personas">
        {activePersonaEntries.length === 0 ? (
          <span className="empty">No persona filters</span>
        ) : (
          <>
            {activePersonaEntries.slice(0, MAX_VISIBLE_PERSONA_CHIPS).map((persona) => (
              <button
                key={persona.slug}
                className="chip selectable active"
                title="Remove filter"
                onClick={() => props.onTogglePersona(persona.slug)}
              >
                {persona.label} ✕
              </button>
            ))}
            {activePersonaEntries.length > MAX_VISIBLE_PERSONA_CHIPS && (
              <button
                className="chip selectable"
                title={activePersonaEntries
                  .slice(MAX_VISIBLE_PERSONA_CHIPS)
                  .map((persona) => persona.label)
                  .join(", ")}
                onClick={() => {
                  if (personaDropdown.current) personaDropdown.current.open = true;
                }}
              >
                +{activePersonaEntries.length - MAX_VISIBLE_PERSONA_CHIPS}
              </button>
            )}
          </>
        )}
      </div>

      <div className="card-scroll">
        {suggestions.length === 0 ? (
          <p className="empty">No bundles match.</p>
        ) : (
          <div className="card-grid">
            {suggestions.map((suggestion) => (
              <BundleCard
                key={suggestion.bundle.name}
                suggestion={suggestion}
                onSelect={props.onSelect}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
