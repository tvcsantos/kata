import { app, shell } from "electron";
import electronUpdater from "electron-updater";
import { parse as parseYaml } from "yaml";
import type { UpdateState } from "../shared/bridge";

/** Where macOS users are sent to download a new build (with Gatekeeper help). */
const DOWNLOAD_PAGE_URL = "https://tiago.santos.com.pt/kata/guide/app#installing";

/** The rolling machine channel that holds the newest installers + metadata. */
const CHANNEL_BASE_URL = "https://github.com/tvcsantos/kata/releases/download/desktop-latest";

/**
 * Two-tier app self-update:
 *  - Windows / Linux: electron-updater downloads in the background and
 *    installs on restart (works unsigned on these platforms).
 *  - macOS: unsigned apps can't self-update (Squirrel.Mac requires a valid
 *    signature), so we only notify and link to the download page.
 *
 * Both tiers read the same rolling `desktop-latest` release, so the updater
 * resolves correctly despite the many per-package releases in the monorepo.
 */
export class UpdateService {
  private state: UpdateState;
  private readonly canAutoUpdate: boolean;

  constructor(private readonly emit: (state: UpdateState) => void) {
    // No channel to read in a dev build (no app-update.yml is packaged).
    if (!app.isPackaged) {
      this.canAutoUpdate = false;
      this.state = { status: "unsupported" };
      return;
    }
    this.canAutoUpdate = process.platform === "win32" || process.platform === "linux";
    this.state = { status: "idle" };
    if (this.canAutoUpdate) this.wireAutoUpdater();
  }

  current(): UpdateState {
    return this.state;
  }

  async check(): Promise<void> {
    if (this.state.status === "unsupported") return;
    this.setState({ status: "checking" });
    try {
      if (this.canAutoUpdate) {
        await electronUpdater.autoUpdater.checkForUpdates();
      } else {
        await this.checkMac();
      }
    } catch (error) {
      this.setState({ status: "error", message: (error as Error).message });
    }
  }

  async install(): Promise<void> {
    if (this.state.status === "downloaded" && this.canAutoUpdate) {
      electronUpdater.autoUpdater.quitAndInstall();
      return;
    }
    // macOS / manual tier: send the user to the download page.
    await shell.openExternal(DOWNLOAD_PAGE_URL);
  }

  private setState(state: UpdateState): void {
    this.state = state;
    this.emit(state);
  }

  private wireAutoUpdater(): void {
    const updater = electronUpdater.autoUpdater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    let availableVersion = "";
    updater.on("checking-for-update", () => this.setState({ status: "checking" }));
    updater.on("update-not-available", () => this.setState({ status: "not-available" }));
    updater.on("update-available", (info) => {
      availableVersion = info.version;
      this.setState({ status: "available", version: info.version, mode: "auto" });
    });
    updater.on("download-progress", (progress) =>
      this.setState({
        status: "downloading",
        version: availableVersion,
        percent: Math.round(progress.percent),
      }),
    );
    updater.on("update-downloaded", (info) =>
      this.setState({ status: "downloaded", version: info.version }),
    );
    updater.on("error", (error) => this.setState({ status: "error", message: error.message }));
  }

  /** macOS notifier: read the channel's version and compare to this build. */
  private async checkMac(): Promise<void> {
    const response = await fetch(`${CHANNEL_BASE_URL}/latest-mac.yml`, {
      headers: { accept: "text/yaml" },
    });
    if (!response.ok) throw new Error(`Update check failed: HTTP ${response.status}`);
    const meta = parseYaml(await response.text()) as { version?: string };
    const latest = meta.version;
    if (!latest || !isNewer(latest, app.getVersion())) {
      this.setState({ status: "not-available" });
      return;
    }
    this.setState({ status: "available", version: latest, mode: "manual" });
  }
}

/** True when `candidate` is a higher x.y.z than `current`. */
function isNewer(candidate: string, current: string): boolean {
  const toParts = (value: string) =>
    value
      .split(".")
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0));
  const [a, b, c] = toParts(candidate);
  const [x, y, z] = toParts(current);
  if (a !== x) return (a ?? 0) > (x ?? 0);
  if (b !== y) return (b ?? 0) > (y ?? 0);
  return (c ?? 0) > (z ?? 0);
}
