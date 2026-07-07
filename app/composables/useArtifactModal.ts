// Shared state for the markdown artifact modal — a single instance mounted
// at the app root reads/writes this. Anything (e.g. MessageContent) can call
// openTasksMd(changeId) to pop the modal without plumbing events.
import { reactive } from "vue";
import { useOpenSpec } from "./useOpenSpec";

type ArtifactKind = "tasks-md";

interface ArtifactModalState {
  open: boolean;
  kind: ArtifactKind | null;
  changeId: string;
}

const state = reactive<ArtifactModalState>({
  open: false,
  kind: null,
  changeId: "",
});

export function useArtifactModal() {
  const openspec = useOpenSpec();

  function openTasksMd(changeId: string) {
    if (!changeId) return;
    state.changeId = changeId;
    state.kind = "tasks-md";
    state.open = true;
  }

  function close() {
    state.open = false;
  }

  function resolveContent(): { title: string; raw: string; path: string } | null {
    if (!state.changeId) return null;
    const all = [...openspec.state.activeChanges, ...openspec.state.archivedChanges];
    const change = all.find((c) => c.id === state.changeId);
    if (!change) return null;
    if (state.kind === "tasks-md") {
      return {
        title: "tasks.md",
        raw: change.tasksRaw ?? "",
        path: change.taskPath,
      };
    }
    return null;
  }

  return { state, openTasksMd, close, resolveContent };
}
