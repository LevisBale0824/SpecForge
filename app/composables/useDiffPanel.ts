import { ref } from "vue";

export type ViewId = "diff" | "console";

const showDiffPanel = ref(false);
const activeView = ref<ViewId | null>(null);

export function useDiffPanel() {
  function toggleDiffPanel() {
    showDiffPanel.value = !showDiffPanel.value;
    if (!showDiffPanel.value) activeView.value = null;
    else activeView.value = null;
  }
  function setActiveView(view: ViewId | null) {
    activeView.value = view;
    if (view !== null && !showDiffPanel.value) showDiffPanel.value = true;
  }
  return { showDiffPanel, toggleDiffPanel, activeView, setActiveView };
}
