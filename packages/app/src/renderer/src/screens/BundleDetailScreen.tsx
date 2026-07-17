import Markdown from "react-markdown";
import type { RegistryBundle, RegistryMcpServer } from "../../../shared/registry";

function launchCommand(server: RegistryMcpServer): string {
  return server.command ? [server.command, ...server.args].join(" ") : (server.url ?? "?");
}

function provenance(bundle: RegistryBundle & { registryUrl?: string }): {
  label: string;
  value: string;
}[] {
  const rows: { label: string; value: string }[] = [];
  if (bundle.registryUrl) rows.push({ label: "Registry", value: bundle.registryUrl });
  if (bundle.source.kind === "git") {
    rows.push({ label: "Source", value: bundle.source.url });
    if (bundle.source.subdir) {
      rows.push({ label: "Directory", value: bundle.source.subdir });
    }
    rows.push({
      label: "Ref",
      value: `${bundle.source.ref} @ ${bundle.source.commit.slice(0, 7)}`,
    });
  } else {
    rows.push({ label: "Source", value: `registry path ${bundle.source.path}` });
  }
  if (bundle.homepage) rows.push({ label: "Homepage", value: bundle.homepage });
  if (bundle.license) rows.push({ label: "License", value: bundle.license });
  if (bundle.authors.length > 0) {
    rows.push({ label: "Authors", value: bundle.authors.map((author) => author.name).join(", ") });
  }
  return rows;
}

function NameList(props: { title: string; names: string[] }): React.JSX.Element | null {
  if (props.names.length === 0) return null;
  return (
    <>
      <h3>{props.title}</h3>
      <ul>
        {props.names.map((name) => (
          <li key={name}>
            <code>{name}</code>
          </li>
        ))}
      </ul>
    </>
  );
}

export function BundleDetailScreen(props: {
  bundle: RegistryBundle & { registryUrl?: string };
  onBack: () => void;
  onInstall: () => void;
}): React.JSX.Element {
  const { bundle } = props;
  return (
    <section className="detail">
      <div className="screen-head">
        <button className="back" onClick={props.onBack}>
          ← Bundles
        </button>
        <button className="primary" onClick={props.onInstall}>
          Install on a project…
        </button>
      </div>

      <div className="card-head">
        {bundle.iconDataUri ? (
          <img className="card-icon" src={bundle.iconDataUri} alt="" />
        ) : (
          <span className="card-icon placeholder">{bundle.name.slice(0, 2)}</span>
        )}
        <h1>{bundle.name}</h1>
        {bundle.verified && (
          <span className="verified-icon" title="Verified - reviewed by registry maintainers">
            ✓
          </span>
        )}
        {bundle.version && <span className="chip">v{bundle.version}</span>}
      </div>
      {bundle.description && <p>{bundle.description}</p>}

      <div className="chips">
        {bundle.personas.map((persona) => (
          <span key={persona} className="chip enabled">
            {persona}
          </span>
        ))}
        {bundle.tags.map((tag) => (
          <span key={tag} className="chip">
            #{tag}
          </span>
        ))}
        {bundle.targets.map((target) => (
          <span key={target} className="chip">
            {target}
          </span>
        ))}
      </div>

      <div className="detail-scroll">
        <h2>Provenance</h2>
        <table>
          <tbody>
            {provenance(bundle).map((row) => (
              <tr key={row.label}>
                <th>{row.label}</th>
                <td className="source">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>What this bundle adds</h2>
        <NameList title="Instructions" names={bundle.contents.instructions} />
        {bundle.contents.mcpServers.length > 0 && (
          <>
            <h3>MCP servers</h3>
            <p className="empty">
              These commands will run on your machine when your agent uses them.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Runs</th>
                  <th>Needs env</th>
                </tr>
              </thead>
              <tbody>
                {bundle.contents.mcpServers.map((server) => (
                  <tr key={server.name}>
                    <td>{server.name}</td>
                    <td className="source">{launchCommand(server)}</td>
                    <td className="source">{server.env.join(", ") || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <NameList title="Prompts" names={bundle.contents.prompts} />
        <NameList title="Agents" names={bundle.contents.agents} />
        <NameList title="Skills" names={bundle.contents.skills} />

        {(bundle.requires.env.length > 0 || bundle.requires.tools.length > 0) && (
          <div className="notice">
            {bundle.requires.env.length > 0 && (
              <p>
                Set{" "}
                {bundle.requires.env.map((varName, index) => (
                  <span key={varName}>
                    {index > 0 && ", "}
                    <code>{varName}</code>
                  </span>
                ))}{" "}
                in your environment before using this bundle.
              </p>
            )}
            {bundle.requires.tools.length > 0 && (
              <p>
                Needs{" "}
                {bundle.requires.tools.map((tool, index) => (
                  <span key={tool}>
                    {index > 0 && ", "}
                    <code>{tool}</code>
                  </span>
                ))}{" "}
                on your PATH.
              </p>
            )}
          </div>
        )}

        {bundle.readme && (
          <>
            <h2>README</h2>
            <div className="markdown">
              <Markdown>{bundle.readme}</Markdown>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
