import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface ScannedArtifact {
  id: string;
  fileName: string;
  filePath: string;
  content: string;
  lastModified: number;
}

interface ProjectState {
  projectPath: string;
  changeId: string;
  openspecDir: string;
}

interface ProjectActions {
  setProject: (path: string) => void;
  scanArtifacts: () => Promise<ScannedArtifact[]>;
}

export const useProjectStore = create<ProjectState & ProjectActions>()((set, get) => ({
  projectPath: "",
  changeId: "",
  openspecDir: "",

  setProject: (path) => {
    set({ projectPath: path, openspecDir: `${path}/openspec` });
  },

  scanArtifacts: async () => {
    const { openspecDir, changeId } = get();
    const dirPath = `${openspecDir}/changes/${changeId}`;
    const result = await invoke<{ name: string; path: string; is_dir: boolean }[]>("scan_artifacts", { dirPath });
    const artifacts = result.map((r) => ({
      id: r.path, fileName: r.name, filePath: r.path, content: "", lastModified: Date.now(),
    }));
    return artifacts;
  },
}));
