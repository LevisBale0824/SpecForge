// Electron preload — plain CommonJS (no build step).
// Must be CJS because contextIsolation preload scripts cannot use ESM.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  selectDirectory: () => ipcRenderer.invoke("selectDirectory"),
  readDirectory: (rootPath, relPath) =>
    ipcRenderer.invoke("readDirectory", rootPath, relPath || ""),
  readWorkspaceDiff: (rootPath) => ipcRenderer.invoke("readWorkspaceDiff", rootPath),
  getServerStatus: () => ipcRenderer.invoke("getServerStatus"),
  restartServer: () => ipcRenderer.invoke("restartServer"),
  getAgentConfig: () => ipcRenderer.invoke("getAgentConfig"),
  setAgentConfig: (config) => ipcRenderer.invoke("setAgentConfig", config),
  readOpenSpecState: (rootPath) => ipcRenderer.invoke("readOpenSpecState", rootPath),
  writeOpenSpecTasks: (rootPath, changeId, taskId, completed) =>
    ipcRenderer.invoke("writeOpenSpecTasks", rootPath, changeId, taskId, completed),
  runOpenSpecValidate: (rootPath, changeId) =>
    ipcRenderer.invoke("runOpenSpecValidate", rootPath, changeId),
  initOpenSpec: (rootPath) => ipcRenderer.invoke("initOpenSpec", rootPath),
  onOpenFolder: (callback) => {
    const handler = (_event, path) => callback(path);
    ipcRenderer.on("menu:openFolder", handler);
    return () => ipcRenderer.removeListener("menu:openFolder", handler);
  },
  isElectron: true,
});
