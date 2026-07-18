import { useEffect, useState } from "react";
import type { AppVersions } from "../../../shared/bridge";
import kataLogo from "../assets/kata-logo.png";

const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

export function AboutScreen(props: { onBack: () => void }): React.JSX.Element {
  const [versions, setVersions] = useState<AppVersions | null>(null);
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");

  useEffect(() => {
    void window.kata.versions().then(setVersions);
    void window.kata.getTheme().then(setTheme);
  }, []);

  function chooseTheme(value: "system" | "light" | "dark"): void {
    setTheme(value);
    void window.kata.setTheme(value);
  }

  return (
    <section className="about">
      <div className="screen-head">
        <button className="back" onClick={props.onBack}>
          ← Bundles
        </button>
        <div className="screen-head-actions">
          <a
            className="icon-link"
            href="https://tiago.santos.com.pt/kata/"
            target="_blank"
            rel="noreferrer"
            title="Open the kata documentation"
            aria-label="Documentation"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z"
              />
            </svg>
          </a>
          <a
            className="icon-link"
            href="https://github.com/tvcsantos/kata"
            target="_blank"
            rel="noreferrer"
            title="Open the kata repository on GitHub"
            aria-label="GitHub repository"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 1.9a10.3 10.3 0 0 0-3.26 20.06c.51.1.7-.22.7-.49l-.01-1.9c-2.86.62-3.47-1.21-3.47-1.21-.47-1.19-1.14-1.5-1.14-1.5-.94-.64.07-.63.07-.63 1.03.07 1.58 1.06 1.58 1.06.92 1.57 2.41 1.12 3 .86.09-.67.36-1.12.65-1.38-2.29-.26-4.69-1.14-4.69-5.09 0-1.12.4-2.04 1.06-2.76-.11-.26-.46-1.31.1-2.73 0 0 .86-.28 2.83 1.05a9.8 9.8 0 0 1 5.15 0c1.96-1.33 2.82-1.05 2.82-1.05.56 1.42.21 2.47.1 2.73.66.72 1.06 1.64 1.06 2.76 0 3.96-2.41 4.83-4.7 5.08.37.32.7.94.7 1.9l-.01 2.81c0 .27.18.6.7.49A10.3 10.3 0 0 0 12 1.9z"
              />
            </svg>
          </a>
        </div>
      </div>

      <div className="about-body">
        <img className="about-logo" src={kataLogo} alt="kata logo" />
        <h1>kata</h1>
        <p className="about-summary">
          One config for every coding agent. Author your instructions, MCP servers, prompts, agents,
          and skills once in <code>.kata/</code> - kata compiles them into the native format of
          every harness your project uses, and this app lets you discover and install shared bundles
          of them.
        </p>

        <h2>Version</h2>
        {versions ? (
          <table className="about-versions">
            <tbody>
              <tr>
                <th>App</th>
                <td>{versions.app}</td>
              </tr>
              <tr>
                <th>Core engine</th>
                <td>{versions.core ?? "unknown"}</td>
              </tr>
              <tr>
                <th>Electron</th>
                <td>{versions.electron}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="empty">Loading...</p>
        )}

        <h2>Appearance</h2>
        <div className="segmented" role="radiogroup" aria-label="Theme">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              role="radio"
              aria-checked={theme === option.value}
              className={theme === option.value ? "active" : undefined}
              onClick={() => chooseTheme(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <h2>License</h2>
        <p className="about-license">
          MIT License · Copyright © 2026 Tiago Santos
          <br />
          Free to use, modify, and distribute.
        </p>
      </div>
    </section>
  );
}
