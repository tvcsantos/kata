import { useEffect, useState } from "react";
import type { RegistrySource, RegistrySourceView } from "../../../shared/registry";
import { RemoveButton } from "../RemoveButton";

/**
 * Manage the configured registries. Order matters: on bundle-name clashes
 * the first-listed registry wins.
 */
export function RegistriesScreen(props: {
  /** Status per source from the last merged fetch; null while loading. */
  sourceViews: RegistrySourceView[] | null;
  onBack: () => void;
  /** Called after any add/remove so the app refetches the merged view. */
  onChanged: () => void;
}): React.JSX.Element {
  const [registries, setRegistries] = useState<RegistrySource[]>([]);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload(): Promise<void> {
    setRegistries(await window.kata.getRegistries());
  }

  useEffect(() => {
    void reload();
  }, []);

  async function add(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await window.kata.addRegistry(url.trim(), name.trim() === "" ? null : name.trim());
      setUrl("");
      setName("");
      await reload();
      props.onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(target: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await window.kata.removeRegistry(target);
      await reload();
      props.onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function statusFor(source: RegistrySource): string {
    const view = props.sourceViews?.find((candidate) => candidate.url === source.url);
    if (!view) return "";
    if (view.error) return "unreachable";
    if (view.offline) return `offline · ${view.bundleCount} bundle(s) cached`;
    return `${view.bundleCount} bundle(s)`;
  }

  return (
    <section className="registries">
      <div className="screen-head">
        <button className="back" onClick={props.onBack}>
          ← Bundles
        </button>
      </div>

      <h1>Registries</h1>
      <p className="empty">
        Bundles are merged from every registry below, in order - on a name clash the first registry
        wins.
      </p>

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
            <div className="registry-meta">
              <span className="empty">{statusFor(source)}</span>
              <RemoveButton
                label={`Remove ${source.name ?? source.url}`}
                disabled={busy}
                onClick={() => void remove(source.url)}
              />
            </div>
          </li>
        ))}
        {registries.length === 0 && (
          <li className="registry-row">
            <span className="empty">No registries configured - add one below.</span>
          </li>
        )}
      </ul>

      <h2>Add a registry</h2>
      <div className="registry-add">
        <input
          type="text"
          placeholder="https://example.com/index.json (or file:///…)"
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
        <button className="primary" disabled={busy || url.trim() === ""} onClick={() => void add()}>
          Add
        </button>
      </div>
    </section>
  );
}
