import { useState } from "react";
import type { RegistryPersona } from "../../../shared/registry";

/**
 * The persona picker: first-run step 2, and later reachable from Browse
 * to change the answer. Multi-select (people are hybrids); at least one
 * is required - the choice pre-filters and ranks Browse.
 */
export function OnboardingScreen(props: {
  personas: RegistryPersona[];
  /** Pre-selected slugs when editing an existing choice. */
  initialSelection?: string[];
  /** Present in edit mode: cancel without saving. */
  onBack?: () => void;
  onDone: (slugs: string[]) => void;
}): React.JSX.Element {
  const [selected, setSelected] = useState<string[]>(props.initialSelection ?? []);

  function toggle(slug: string): void {
    setSelected((current) =>
      current.includes(slug) ? current.filter((other) => other !== slug) : [...current, slug],
    );
  }

  return (
    <section className="onboarding">
      {props.onBack && (
        <div className="screen-head">
          <button className="back" onClick={props.onBack}>
            ← Bundles
          </button>
        </div>
      )}
      <div className="hero">
        <h1>What kind of work do you do?</h1>
        <p>
          Pick any that fit - this only tailors bundle suggestions, and you can change filters
          anytime.
        </p>
      </div>

      <div className="card-grid">
        {props.personas.map((persona) => (
          <button
            key={persona.slug}
            className={selected.includes(persona.slug) ? "card selected" : "card"}
            onClick={() => toggle(persona.slug)}
          >
            <span className="name">{persona.label}</span>
            <p>{persona.blurb}</p>
          </button>
        ))}
      </div>

      <div className="modal-actions">
        <button
          className="primary"
          disabled={selected.length === 0}
          onClick={() => props.onDone(selected)}
        >
          {props.onBack ? "Save" : "Continue"}
        </button>
      </div>
    </section>
  );
}
