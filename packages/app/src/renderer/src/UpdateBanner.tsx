import { useEffect, useState } from "react";
import type { UpdateState } from "../../shared/bridge";

/**
 * A slim banner shown when an app update is available. Windows/Linux download
 * automatically and offer a restart; macOS links to the download page.
 */
export function UpdateBanner(): React.JSX.Element | null {
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    void window.kata.getUpdateState().then(setState);
    return window.kata.onUpdateState(setState);
  }, []);

  useEffect(() => {
    setDismissed(false);
  }, [state.status]);

  if (dismissed) return null;

  if (state.status === "available") {
    return (
      <div className="update-banner">
        <span>
          Kata {state.version} is available
          {state.mode === "auto" ? " — downloading…" : "."}
        </span>
        <div className="update-banner-actions">
          {state.mode === "manual" && (
            <button className="primary" onClick={() => void window.kata.installUpdate()}>
              Download
            </button>
          )}
          <button className="ghost" onClick={() => setDismissed(true)}>
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  if (state.status === "downloading") {
    return (
      <div className="update-banner">
        <span>
          Downloading Kata {state.version}… {state.percent}%
        </span>
      </div>
    );
  }

  if (state.status === "downloaded") {
    return (
      <div className="update-banner">
        <span>Kata {state.version} is ready to install.</span>
        <div className="update-banner-actions">
          <button className="primary" onClick={() => void window.kata.installUpdate()}>
            Restart to update
          </button>
          <button className="ghost" onClick={() => setDismissed(true)}>
            Later
          </button>
        </div>
      </div>
    );
  }

  return null;
}
