import { contextBridge, ipcRenderer } from "electron";
import type { KataBridge, UpdateState } from "../shared/bridge";

/**
 * The renderer-facing bridge. Only these functions exist in the page's
 * world - no raw ipcRenderer, no Node globals. Channel names are fixed here;
 * the renderer cannot invoke arbitrary channels.
 */
const bridge: KataBridge = {
  pickProjectFolder: () => ipcRenderer.invoke("kata:pickProjectFolder"),
  openProject: (dir) => ipcRenderer.invoke("kata:openProject", dir),
  initProject: (dir) => ipcRenderer.invoke("kata:initProject", dir),
  recentProjects: () => ipcRenderer.invoke("kata:recentProjects"),
  versions: () => ipcRenderer.invoke("kata:versions"),
  getRegistry: (options) => ipcRenderer.invoke("kata:getRegistry", options),
  getRegistries: () => ipcRenderer.invoke("kata:getRegistries"),
  getSuggestedRegistry: () => ipcRenderer.invoke("kata:getSuggestedRegistry"),
  addRegistry: (url, name) => ipcRenderer.invoke("kata:addRegistry", url, name),
  removeRegistry: (url) => ipcRenderer.invoke("kata:removeRegistry", url),
  installBundle: (projectId, bundleName) =>
    ipcRenderer.invoke("kata:installBundle", projectId, bundleName),
  uninstallBundle: (projectId, bundleName) =>
    ipcRenderer.invoke("kata:uninstallBundle", projectId, bundleName),
  updateBundle: (projectId, bundleName) =>
    ipcRenderer.invoke("kata:updateBundle", projectId, bundleName),
  planProject: (projectId) => ipcRenderer.invoke("kata:planProject", projectId),
  confirmChange: (changeId) => ipcRenderer.invoke("kata:confirmChange", changeId),
  cancelChange: (changeId) => ipcRenderer.invoke("kata:cancelChange", changeId),
  getPersonas: () => ipcRenderer.invoke("kata:getPersonas"),
  setPersonas: (slugs) => ipcRenderer.invoke("kata:setPersonas", slugs),
  getTheme: () => ipcRenderer.invoke("kata:getTheme"),
  setTheme: (theme) => ipcRenderer.invoke("kata:setTheme", theme),
  getUpdateState: () => ipcRenderer.invoke("kata:getUpdateState"),
  checkForUpdates: () => ipcRenderer.invoke("kata:checkForUpdates"),
  installUpdate: () => ipcRenderer.invoke("kata:installUpdate"),
  onUpdateState: (callback) => {
    const listener = (_event: unknown, state: UpdateState): void => callback(state);
    ipcRenderer.on("kata:updateState", listener);
    return () => ipcRenderer.removeListener("kata:updateState", listener);
  },
};

contextBridge.exposeInMainWorld("kata", bridge);
