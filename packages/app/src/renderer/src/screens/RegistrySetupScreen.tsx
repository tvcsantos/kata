import { useEffect, useState } from "react";
import type { RegistrySource } from "../../../shared/registry";
import kataLogo from "../assets/kata-logo.png";
import { RemoveButton } from "../RemoveButton";

/**
 * First-run step 1, the welcome screen: greet, then configure at least
 * one registry. The official one is suggested with a single click, but
 * any registry works - the only requirement is that one exists before
 * moving on.
 */
export function RegistrySetupScreen(props: { onDone: () => void }): React.JSX.Element {
  const [registries, setRegistries] = useState<RegistrySource[]>([]);
  const [suggested, setSuggested] = useState<{ url: string; name: string } | null>(null);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload(): Promise<void> {
    setRegistries(await window.kata.getRegistries());
  }

  useEffect(() => {
    void reload();
    void window.kata.getSuggestedRegistry().then(setSuggested);
  }, []);

  async function add(targetUrl: string, targetName: string | null): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await window.kata.addRegistry(targetUrl, targetName);
      setUrl("");
      setName("");
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(targetUrl: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await window.kata.removeRegistry(targetUrl);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const suggestedAdded =
    suggested !== null && registries.some((source) => source.url === suggested.url);

  return (
    <section className="onboarding welcome">
      <div className="hero">
        <img className="welcome-logo" src={kataLogo} alt="" />
        <h1>Welcome to kata</h1>
        <p>One config for every coding agent - let's set you up in two quick steps.</p>
        <h2 className="welcome-question">Where should your bundles come from?</h2>
        <p className="welcome-hint">
          Add at least one registry - a catalog of installable bundles. You can change this anytime.
        </p>
      </div>

      <div className="setup-body">
        {error && (
          <div className="notice">
            <p>{error}</p>
          </div>
        )}

        <ul className="recents">
          {registries.map((source) => (
            <li key={source.url} className="registry-row">
              <div className="registry-info">
                <span className="name">{source.name ?? source.url}</span>
                <span className="dir">{source.url}</span>
              </div>
              <RemoveButton
                label={`Remove ${source.name ?? source.url}`}
                disabled={busy}
                onClick={() => void remove(source.url)}
              />
            </li>
          ))}
          {suggested && !suggestedAdded && (
            <li className="registry-row suggested">
              <div className="registry-info">
                <span className="name">
                  {suggested.name} <span className="chip">suggested</span>
                </span>
                <span className="dir">{suggested.url}</span>
              </div>
              <button
                className="icon-button add"
                title="Add this registry"
                aria-label={`Add ${suggested.name}`}
                disabled={busy}
                onClick={() => void add(suggested.url, suggested.name)}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    d="M12 5v14M5 12h14"
                  />
                </svg>
              </button>
            </li>
          )}
        </ul>

        <div className="registry-add">
          <input
            type="text"
            placeholder="https://example.com/index.json (or file:///...)"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <input
            type="text"
            className="registry-name"
            placeholder="Name (optional)"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button
            disabled={busy || url.trim() === ""}
            onClick={() => void add(url.trim(), name.trim() === "" ? null : name.trim())}
          >
            Add
          </button>
        </div>
      </div>

      <div className="modal-actions">
        <button className="primary" disabled={registries.length === 0} onClick={props.onDone}>
          Continue
        </button>
      </div>
    </section>
  );
}
