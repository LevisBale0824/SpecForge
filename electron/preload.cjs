// Electron preload — plain CommonJS (no build step).
// Must be CJS because contextIsolation preload scripts cannot use ESM.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Resolve an absolute OS path for a dropped File. Electron's webUtils is the
  // supported replacement for the deprecated `File.path` getter. Must be called
  // from the preload because webUtils is only available here, not in the
  // renderer's isolated world.
  getPathForFile: (file) => webUtils.getPathForFile(file),
  // ── Shared preferences (multi-instance consistency) ───────────────────
  // Hydrate localStorage on boot + mirror writes. See app/utils/storageKeys.ts.
  prefsGetAll: () => ipcRenderer.invoke("prefs:getAll"),
  prefsSet: (key, value) => ipcRenderer.invoke("prefs:set", key, value),
  selectDirectory: () => ipcRenderer.invoke("selectDirectory"),
  openExternalUrl: (url) => ipcRenderer.invoke("openExternalUrl", url),
  readDirectory: (rootPath, relPath) =>
    ipcRenderer.invoke("readDirectory", rootPath, relPath || ""),
  readFileIndex: (rootPath) => ipcRenderer.invoke("readFileIndex", rootPath),
  readWorkspaceDiff: (rootPath) => ipcRenderer.invoke("readWorkspaceDiff", rootPath),
  getServerStatus: () => ipcRenderer.invoke("getServerStatus"),
  restartServer: (kind) => ipcRenderer.invoke("restartServer", kind),
  getAgentConfig: () => ipcRenderer.invoke("getAgentConfig"),
  setAgentConfig: (config) => ipcRenderer.invoke("setAgentConfig", config),
  stopAgentServer: () => ipcRenderer.invoke("stopAgentServer"),
  readOpenSpecState: (rootPath) => ipcRenderer.invoke("readOpenSpecState", rootPath),
  writeOpenSpecTasks: (rootPath, changeId, taskId, completed) =>
    ipcRenderer.invoke("writeOpenSpecTasks", rootPath, changeId, taskId, completed),
  removeChangeDir: (rootPath, changeId) =>
    ipcRenderer.invoke("removeChangeDir", rootPath, changeId),
  runOpenSpecValidate: (rootPath, changeId) =>
    ipcRenderer.invoke("runOpenSpecValidate", rootPath, changeId),
  initOpenSpec: (rootPath) => ipcRenderer.invoke("initOpenSpec", rootPath),
  runProjectGate: (rootPath, command) =>
    ipcRenderer.invoke("runProjectGate", rootPath, command),
  writeChangeArtifact: (rootPath, changeId, filename, content) =>
    ipcRenderer.invoke("writeChangeArtifact", rootPath, changeId, filename, content),
  readChangeArtifact: (rootPath, changeId, filename) =>
    ipcRenderer.invoke("readChangeArtifact", rootPath, changeId, filename),
  windowMinimize: () => ipcRenderer.invoke("window:minimize"),
  windowToggleMaximize: () => ipcRenderer.invoke("window:toggleMaximize"),
  windowClose: () => ipcRenderer.invoke("window:close"),
  windowIsMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  consoleExec: (cmd, cwd) => ipcRenderer.invoke("console:exec", { cmd, cwd }),
  consoleKill: (pid) => ipcRenderer.invoke("console:kill", pid),
  onConsoleData: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("console:data", handler);
    return () => ipcRenderer.removeListener("console:data", handler);
  },
  onWindowMaximizeChange: (callback) => {
    const handler = (_event, isMaximized) => callback(isMaximized);
    ipcRenderer.on("window:maximizeChange", handler);
    return () => ipcRenderer.removeListener("window:maximizeChange", handler);
  },
  onOpenFolder: (callback) => {
    const handler = (_event, path) => callback(path);
    ipcRenderer.on("menu:openFolder", handler);
    return () => ipcRenderer.removeListener("menu:openFolder", handler);
  },
  // ── Auto-updater ───────────────────────────────────────────────────────
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  getAppVersion: () => ipcRenderer.invoke("update:getVersion"),
  getUpdatePrefs: () => ipcRenderer.invoke("update:getPrefs"),
  setUpdateAutoCheck: (enabled) =>
    ipcRenderer.invoke("update:setAutoCheck", enabled),
  setUpdateProxy: (proxy) => ipcRenderer.invoke("update:setProxy", proxy),
  skipUpdateVersion: (version) => ipcRenderer.invoke("update:skipVersion", version),
  onUpdateEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("update:event", handler);
    return () => ipcRenderer.removeListener("update:event", handler);
  },
  isElectron: true,
});
