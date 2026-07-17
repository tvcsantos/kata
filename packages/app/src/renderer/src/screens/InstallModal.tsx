import { useEffect, useState } from "react";
import type { FileDiff } from "@katahq/core";
import type {
  ChangeOutcome,
  ChangePreview,
  RecentProject,
  TargetDiffView,
} from "../../../shared/bridge";
import type { RegistryBundle } from "../../../shared/registry";

/**
 * The whole install lives here: pick a project, stage, review the diff,
 * apply. Deliberately stateless towards the rest of the app - no project
 * stays "selected" after the modal closes; every install picks its target.
 */

type Step =
  | { step: "pick"; error: string | null; errorDir: string | null }
  | { step: "staging" }
  | { step: "preview"; preview: ChangePreview }
  | { step: "applying"; preview: ChangePreview }
  | { step: "done"; outcome: ChangeOutcome }
  | { step: "failed"; message: string };

function actionBadge(diff: FileDiff): React.JSX.Element {
  const label =
    diff.action === "create" ? "+ create" : diff.action === "update" ? "~ update" : "ok";
  return <span className={`diff-action ${diff.action}`}>{label}</span>;
}

function DiffHunks(props: { diff: FileDiff }): React.JSX.Element {
  if (props.diff.binary) return <p className="empty">Binary file.</p>;
  return (
    <pre className="diff">
      {props.diff.hunks.map((hunk, hunkIndex) => (
        <span key={hunkIndex}>
          <span className="hunk-header">
            {`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`}
          </span>
          {hunk.lines.map((line, lineIndex) => (
            <span
              key={lineIndex}
              className={
                line.startsWith("+") ? "line-add" : line.startsWith("-") ? "line-del" : undefined
              }
            >
              {line}
              {"\n"}
            </span>
          ))}
        </span>
      ))}
    </pre>
  );
}

function TargetDiffs(props: { target: TargetDiffView }): React.JSX.Element {
  const { target } = props;
  const changed = target.files.filter((file) => file.action !== "unchanged");
  return (
    <div>
      <h3>
        {target.target}
        {!target.detected && <span className="empty"> (not detected on this machine)</span>}
      </h3>
      {changed.length === 0 && <p className="empty">No changes for this target.</p>}
      {changed.map((file) => (
        <details key={`${file.scope}:${file.relativePath}`} className="diff-file">
          <summary>
            {actionBadge(file)} <code>{file.relativePath}</code>
            {file.managedRegionOnly && (
              <span
                className="badge managed"
                title="Only the kata-managed region changes; your hand edits are untouched"
              >
                managed region only
              </span>
            )}
          </summary>
          <DiffHunks diff={file} />
        </details>
      ))}
      {target.warnings.map((warning) => (
        <p key={warning.message} className="warning">
          ! {warning.message}
        </p>
      ))}
    </div>
  );
}

export function InstallModal(props: {
  bundle: RegistryBundle;
  onClose: () => void;
}): React.JSX.Element {
  const { bundle } = props;
  const [step, setStep] = useState<Step>({ step: "pick", error: null, errorDir: null });
  const [recents, setRecents] = useState<RecentProject[]>([]);

  useEffect(() => {
    void window.kata.recentProjects().then(setRecents);
  }, []);

  async function chooseProject(dir: string, initialize: boolean): Promise<void> {
    setStep({ step: "staging" });
    try {
      const project = initialize
        ? await window.kata.initProject(dir)
        : await window.kata.openProject(dir);
      const preview = await window.kata.installBundle(project.projectId, bundle.name);
      setStep({ step: "preview", preview });
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("kata init")) {
        setStep({ step: "pick", error: message, errorDir: dir });
      } else {
        setStep({ step: "failed", message });
      }
    }
  }

  async function pickFolder(): Promise<void> {
    const dir = await window.kata.pickProjectFolder();
    if (dir) await chooseProject(dir, false);
  }

  async function confirm(): Promise<void> {
    if (step.step !== "preview") return;
    setStep({ step: "applying", preview: step.preview });
    try {
      setStep({ step: "done", outcome: await window.kata.confirmChange(step.preview.changeId) });
    } catch (err) {
      setStep({ step: "failed", message: (err as Error).message });
    }
  }

  async function cancel(): Promise<void> {
    if (step.step === "preview") {
      try {
        await window.kata.cancelChange(step.preview.changeId);
      } catch {
        // Best-effort; staging lives outside the repo.
      }
    }
    props.onClose();
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        {step.step === "pick" && (
          <>
            <h2>Install {bundle.name}</h2>
            <p className="empty">Choose the project to install into.</p>
            {step.error && (
              <div className="notice">
                <p>{step.error}</p>
                {step.errorDir && (
                  <button onClick={() => void chooseProject(step.errorDir!, true)}>
                    Initialize kata in {step.errorDir}
                  </button>
                )}
              </div>
            )}
            {recents.length > 0 && (
              <ul className="recents">
                {recents.map((recent) => (
                  <li key={recent.dir}>
                    <button onClick={() => void chooseProject(recent.dir, false)}>
                      <span className="name">{recent.name}</span>
                      <span className="dir">{recent.dir}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="modal-actions">
              <button onClick={props.onClose}>Cancel</button>
              <button className="primary" onClick={() => void pickFolder()}>
                Open folder…
              </button>
            </div>
          </>
        )}

        {step.step === "staging" && (
          <>
            <h2>Install {bundle.name}</h2>
            <p className="empty">Fetching the bundle and computing the plan…</p>
          </>
        )}

        {(step.step === "preview" || step.step === "applying") && (
          <>
            <h2>
              Install {bundle.name}
              {step.preview.version ? ` v${step.preview.version}` : ""}
            </h2>
            <p className="empty">
              Vendors into <code>{step.preview.composeRef ?? "?"}</code>. Nothing has been written
              yet - review the changes below.
            </p>
            {step.preview.targets.map((target) => (
              <TargetDiffs key={target.target} target={target} />
            ))}
            <div className="modal-actions">
              <button onClick={() => void cancel()} disabled={step.step === "applying"}>
                Cancel
              </button>
              <button
                className="primary"
                onClick={() => void confirm()}
                disabled={step.step === "applying"}
              >
                {step.step === "applying"
                  ? "Applying…"
                  : `Apply ${step.preview.summary.creates + step.preview.summary.updates} change(s)`}
              </button>
            </div>
          </>
        )}

        {step.step === "done" && (
          <>
            <h2>Installed {step.outcome.bundleName ?? bundle.name}</h2>
            {step.outcome.writtenFiles.length > 0 ? (
              <>
                <p>Wrote:</p>
                <ul>
                  {step.outcome.writtenFiles.map((file) => (
                    <li key={file}>
                      <code>{file}</code>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="empty">No native files needed changes.</p>
            )}
            {step.outcome.requiresEnv.length > 0 && (
              <div className="notice">
                <p>
                  Before using it, set{" "}
                  {step.outcome.requiresEnv.map((varName, index) => (
                    <span key={varName}>
                      {index > 0 && ", "}
                      <code>{varName}</code>
                    </span>
                  ))}{" "}
                  in your environment.
                </p>
              </div>
            )}
            <div className="modal-actions">
              <button className="primary" onClick={props.onClose}>
                Done
              </button>
            </div>
          </>
        )}

        {step.step === "failed" && (
          <>
            <h2>Install failed</h2>
            <div className="notice">
              <p>{step.message}</p>
            </div>
            <div className="modal-actions">
              <button onClick={props.onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
