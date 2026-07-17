import path from "node:path";
import { app, BrowserWindow, nativeImage, nativeTheme, session, shell } from "electron";
import { EngineService } from "./engine-service";
import { registerIpcHandlers } from "./ipc";
import { PreferencesStore } from "./preferences-store";
import { ProjectStore } from "./project-store";
import { RegistryManager } from "./registry-manager";
import { DEFAULT_REGISTRY_URL } from "./registry-service";

/**
 * Security posture (see PLAN_APP.md §7): the renderer displays third-party
 * content (bundle READMEs, instruction files), so it runs fully sandboxed -
 * no Node, no direct network, no navigation - and everything crosses the
 * typed preload bridge.
 */

const appIcon = nativeImage.createFromPath(path.join(__dirname, "../../resources/icon.png"));

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.on("ready-to-show", () => window.show());

  // External links open in the OS browser, never inside the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    void window.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

void app.whenReady().then(() => {
  // The renderer never talks to the network directly; deny anything that
  // is not the app's own content (dev server, file://, devtools).
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    const allowed =
      url.startsWith("file://") ||
      url.startsWith("devtools://") ||
      url.startsWith("chrome-extension://") ||
      (process.env["ELECTRON_RENDERER_URL"] !== undefined &&
        (url.startsWith("http://localhost") ||
          url.startsWith("ws://localhost") ||
          url.startsWith("http://127.0.0.1") ||
          url.startsWith("ws://127.0.0.1")));
    callback({ cancel: !allowed });
  });

  // Windows/Linux take the icon from BrowserWindow; the macOS dock is set
  // here at runtime (packaged builds get a proper .icns at M8).
  if (process.platform === "darwin" && !appIcon.isEmpty()) {
    app.dock?.setIcon(appIcon);
  }

  const engine = new EngineService();
  const store = new ProjectStore();
  const preferences = new PreferencesStore();
  // Apply the saved theme before the window shows (async is fine pre-load).
  void preferences.theme().then((theme) => {
    nativeTheme.themeSource = theme;
  });
  const registry = new RegistryManager(app.getPath("userData"), preferences);
  registerIpcHandlers(engine, store, registry, preferences);

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("web-contents-created", (_event, contents) => {
  // The app is a single local page; any navigation is hostile or a bug.
  contents.on("will-navigate", (event, url) => {
    if (url !== contents.getURL()) event.preventDefault();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
