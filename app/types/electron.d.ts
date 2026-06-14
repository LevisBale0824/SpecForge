export type DirEntry = {
  name: string;
  kind: "file" | "directory";
  /** POSIX-style path relative to the opened root. */
  path: string;
};

export type WorkspaceFileDiff = {
  file: string;
  before?: string;
  after?: string;
  patch?: string;
  additions: number;
  deletions: number;
  status?: "added" | "deleted" | "modified";
};

export interface ElectronAPI {
  selectDirectory: () => Promise<string | null>;
  readDirectory: (rootPath: string, relPath: string) => Promise<DirEntry[] | null>;
  readWorkspaceDiff: (rootPath: string) => Promise<WorkspaceFileDiff[]>;
  getServerStatus: () => Promise<{
    running: boolean;
    port: number;
    pid: number;
  }>;
  restartServer: () => Promise<{
    running: boolean;
    port: number;
    pid: number;
  }>;
  onOpenFolder: (callback: (path: string) => void) => () => void;
  isElectron: true;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
