import { app, dialog, ipcMain, nativeTheme } from "electron";
import type { AppVersions } from "../shared/bridge";
import type { EngineService } from "./engine-service";
import type { PreferencesStore } from "./preferences-store";
import type { ProjectStore } from "./project-store";
import type { RegistryManager } from "./registry-manager";
import { DEFAULT_REGISTRY_URL } from "./registry-service";
import type { UpdateService } from "./update-service";

/** Injected by electron-vite `define` from the bundled @katahq/core version. */
declare const __CORE_VERSION__: string;

function embeddedCoreVersion(): string | null {
  return typeof __CORE_VERSION__ === "string" ? __CORE_VERSION__ : null;
}

/**
 * The main-side half of the KataBridge contract. Channel names mirror the
 * bridge method names; every handler takes plain data and returns plain data.
 */
export function registerIpcHandlers(
  engine: EngineService,
  store: ProjectStore,
  registry: RegistryManager,
  preferences: PreferencesStore,
  updates: UpdateService,
): void {
  ipcMain.handle("kata:pickProjectFolder", async () => {
    const result = await dialog.showOpenDialog({
      title: "Open a project",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle("kata:openProject", async (_event, dir: unknown) => {
    const info = await engine.open(String(dir));
    await store.remember(info.dir, info.name);
    return info;
  });

  ipcMain.handle("kata:initProject", async (_event, dir: unknown) => {
    const info = await engine.init(String(dir));
    await store.remember(info.dir, info.name);
    return info;
  });

  ipcMain.handle("kata:recentProjects", () => store.recents());

  ipcMain.handle("kata:getRegistry", (_event, options: unknown) => {
    const refresh =
      typeof options === "object" && options !== null && (options as { refresh?: boolean }).refresh;
    return registry.get({ refresh: refresh === true });
  });

  ipcMain.handle("kata:installBundle", async (_event, projectId: unknown, bundleName: unknown) => {
    const view = await registry.get();
    const bundle = view.bundles.find((candidate) => candidate.name === String(bundleName));
    if (!bundle) {
      throw new Error(`Bundle "${String(bundleName)}" is not in any configured registry.`);
    }
    const source = registry.resolveInstallSource(bundle);
    return engine.stageBundleInstall(String(projectId), bundle, source);
  });

  ipcMain.handle("kata:getRegistries", () => registry.sources());

  // The official registry, offered (never forced) during first-run setup.
  ipcMain.handle("kata:getSuggestedRegistry", (): { url: string; name: string } => {
    return {
      url: process.env["KATA_REGISTRY_URL"] ?? DEFAULT_REGISTRY_URL,
      name: "kata registry (official)",
    };
  });

  ipcMain.handle("kata:addRegistry", (_event, url: unknown, name: unknown) =>
    preferences.addRegistry({
      url: String(url).trim(),
      name: typeof name === "string" && name.trim() !== "" ? name.trim() : null,
    }),
  );

  ipcMain.handle("kata:removeRegistry", (_event, url: unknown) =>
    preferences.removeRegistry(String(url)),
  );

  ipcMain.handle("kata:uninstallBundle", (_event, projectId: unknown, bundleName: unknown) =>
    engine.stageBundleUninstall(String(projectId), String(bundleName)),
  );

  ipcMain.handle("kata:updateBundle", (_event, projectId: unknown, bundleName: unknown) =>
    engine.stageBundleUpdate(String(projectId), String(bundleName)),
  );

  ipcMain.handle("kata:planProject", (_event, projectId: unknown) =>
    engine.stageReapply(String(projectId)),
  );

  ipcMain.handle("kata:confirmChange", (_event, changeId: unknown) =>
    engine.confirmChange(String(changeId)),
  );

  ipcMain.handle("kata:cancelChange", (_event, changeId: unknown) =>
    engine.cancelChange(String(changeId)),
  );

  ipcMain.handle("kata:getPersonas", () => preferences.personas());

  ipcMain.handle("kata:getTheme", () => preferences.theme());

  ipcMain.handle("kata:setTheme", async (_event, theme: unknown) => {
    const value = theme === "light" || theme === "dark" ? theme : "system";
    await preferences.setTheme(value);
    nativeTheme.themeSource = value;
  });

  ipcMain.handle("kata:getUpdateState", () => updates.current());
  ipcMain.handle("kata:checkForUpdates", () => updates.check());
  ipcMain.handle("kata:installUpdate", () => updates.install());

  ipcMain.handle("kata:setPersonas", (_event, slugs: unknown) => {
    const list = Array.isArray(slugs) ? slugs.map(String) : [];
    return preferences.setPersonas(list);
  });

  ipcMain.handle("kata:versions", (): AppVersions => {
    return {
      app: app.getVersion(),
      core: embeddedCoreVersion(),
      electron: process.versions.electron,
    };
  });
}
