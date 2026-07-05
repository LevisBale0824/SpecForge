<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from "vue";
import TopBar from "./components/TopBar.vue";
import SidePanel from "./components/SidePanel.vue";
import StatusBar from "./components/StatusBar.vue";
import InputPanel from "./components/InputPanel.vue";
import FloatingWindow from "./components/FloatingWindow.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import HelpModal from "./components/HelpModal.vue";
import ConsolePanel from "./components/ConsolePanel.vue";
import DiffViewer from "./components/DiffViewer.vue";
import FileViewer from "./components/FileViewer.vue";
import OpenSpecPanel from "./components/openspec/OpenSpecPanel.vue";
import SpecDetailView from "./components/openspec/SpecDetailView.vue";
import TierPickerDialog from "./components/workflow/TierPickerDialog.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import UpdateToast from "./components/UpdateToast.vue";
import UpdateDialog from "./components/UpdateDialog.vue";
import { useRoute, useRouter } from "vue-router";
import { useFloatingWindows } from "./composables/useFloatingWindows";
import { useProject } from "./composables/useProject";
import { useBackend } from "./composables/useBackend";
import { useOpenSpec } from "./composables/useOpenSpec";
import { useStageSessions } from "./composables/useStageSessions";
import { useWorkflow } from "./plugins/workflowPlugin";
import { useResizable } from "./composables/useResizable";
import { isElectron, onOpenFolder, selectDirectory } from "./utils/electronBridge";
import type { MessageDiffEntry } from "./types/message";
import type { SpecTarget } from "./types/openspec";
import type { WorkflowTier } from "./types/workflow";

const route = useRoute();
const router = useRouter();

// Sidebar drag-resize: clamp to [200, 600], persist to localStorage. The
// `resize-active` body class (added by the composable during drag) disables
// text selection so the gesture feels solid.
const sidebarResize = useResizable({
  orientation: "horizontal",
  storageKey: "sidebar.width",
  defaultSize: 300,
  min: 200,
  max: 600,
});
const sidePanelWidth = sidebarResize.size;
const showSettings = ref(false);
const showHelp = ref(false);
const showConsole = ref(false);
const showOpenSpecDialog = ref(false);
const specDetailTarget = ref<SpecTarget | null>(null);
const showTierPicker = ref(false);
const confirmDialog = ref<InstanceType<typeof ConfirmDialog> | null>(null);
const consoleHeight = ref(220);
const consolePanelEl = ref<InstanceType<typeof ConsolePanel> | null>(null);
const backend = useBackend();
const inElectron = isElectron();

const showProjectDialog = ref(false);
const manualPath = ref("");

const isChatRoute = () => route.name === "chat";

// Floating window system (kept for tool-call streaming windows)
const fw = useFloatingWindows();
const floatingEntries = fw.entries;

function updateExtent() {
  fw.setExtent(window.innerWidth, window.innerHeight);
}

// Currently-selected workspace diff, shown in a right-side column instead of
// a floating window so the user can read it alongside the chat.
const activeDiff = ref<MessageDiffEntry | null>(null);

// Currently-open file in the FileViewer modal. Set when the user clicks a
// file entry in the Files tree (the `open-file` event bubbles up through
// SidePanel). Cleared by closing the modal.
const openFiles = ref<string[]>([]);
const activeFilePath = ref<string | null>(null);

// Remember the chat session before entering workflow so returning to chat
// restores it instead of surfacing the workflow's stage session (crosstalk).
const lastChatSessionId = ref("");

// Auto-close the diff viewer when the opened file is no longer in the
// workspace diffs (e.g. user deleted or reverted it externally). Only
// triggers when workspaceDiffs is non-empty so session-originated diffs
// (opened when there are no workspace changes) are left alone.
watch(
  () => backend.workspaceDiffs.value,
  (diffs) => {
    if (!activeDiff.value || diffs.length === 0) return;
    const stillExists = diffs.some((d) => d.file === activeDiff.value!.file);
    if (!stillExists) activeDiff.value = null;
  },
);

const project = useProject();
const openspec = useOpenSpec();
const wf = useWorkflow();
const stageSessions = useStageSessions();
let unsubOpenFolder: (() => void) | null = null;

// On window focus / tab visibility: assume the user might have modified files
// externally (rm/mv/CLI). Without a fs watcher, polling on focus is the
// cheapest way to keep the Files tree + OpenSpec panel in sync.
function onFocusRefresh(): void {
  project.scheduleRefreshTree();
  openspec.scheduleRefresh();
  backend.scheduleWorkspaceDiffRefresh(400);
  // Also invalidate the @ mention menu's cached file list — external edits
  // (rm/mv/CLI) don't fire the `file.edited` SSE event, so we have to pick
  // them up here.
  backend.reloadFileIndex();
}

function onVisibilityChange(): void {
  if (document.visibilityState === "visible") onFocusRefresh();
}

onMounted(() => {
  updateExtent();
  window.addEventListener("resize", updateExtent);
  window.addEventListener("focus", onFocusRefresh);
  document.addEventListener("visibilitychange", onVisibilityChange);
  unsubOpenFolder = onOpenFolder((dirPath) => {
    project.openDirectoryPath(dirPath);
    router.push({ name: "chat" });
  });
});

onUnmounted(() => {
  window.removeEventListener("resize", updateExtent);
  window.removeEventListener("focus", onFocusRefresh);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  unsubOpenFolder?.();
});

function onWindowFocus(key: string) {
  fw.bringToFront(key);
}

function onWindowClose(key: string) {
  fw.close(key);
}

function onSelectSession(sessionId: string) {
  // Selecting a session means leaving the diff/file view, deactivate any
  // active file tab and return to the chat.
  activeDiff.value = null;
  activeFilePath.value = null;
  showOpenSpecDialog.value = false;
  specDetailTarget.value = null;
  backend.selectSession(sessionId);
  router.push({ name: "chat" });
}

function onRefreshFiles(): void {
  // Manual refresh from the sidebar Files header. Re-reads already-loaded
  // directory nodes, invalidates the @ mention cache, and re-syncs the diff
  // + OpenSpec panels. Mirrors onFocusRefresh but immediate (no debounce)
  // and triggered on demand so the user sees new/deleted files at once.
  project.scheduleRefreshTree(0);
  openspec.scheduleRefresh(0);
  backend.scheduleWorkspaceDiffRefresh(0);
  backend.reloadFileIndex();
}

function onDeleteSession(sessionId: string) {
  backend.deleteSession(sessionId);
}

function onAbortSession(sessionId: string) {
  backend.abortSession(sessionId);
}

async function onDeleteWorkflowDraft() {
  const ids = stageSessions.sessionsForWorkflow("__draft__");
  await Promise.all(
    ids.map((id) =>
      backend.deleteSession(id).catch((e) => {
        console.warn(`[App] deleteSession(${id}) failed during draft cleanup:`, e);
      }),
    ),
  );
  stageSessions.clearStageSessions("__draft__");
  wf.disable();
  router.replace({ name: "workflow", query: { intro: "1" } });
}

async function onDeleteActiveChange(changeId: string) {
  if (!changeId) return;
  const confirmed = await confirmDialog.value?.confirm({
    title: `删除活跃探索 "${changeId}"?`,
    message:
      "将移除 openspec/changes/ 下该 change 的整个目录（proposal / tasks / design / specs 等）以及绑定的会话。此操作不可撤销。",
    confirmText: "删除",
    cancelText: "取消",
    danger: true,
  });
  if (!confirmed) return;
  // If we're currently viewing this change, bounce back to draft/intro so the
  // UI doesn't keep showing a stale contract/tasks view after the dir is gone.
  if (route.query.change === changeId) {
    router.replace({ name: "workflow", query: { intro: "1" } });
  }
  await openspec.deleteChange(changeId, {
    onBoundSession: (sid) =>
      backend.deleteSession(sid).catch((e) => {
        console.warn(`[App] deleteSession(${sid}) failed during change cleanup:`, e);
      }),
  });
}

function onNewSession() {
  activeDiff.value = null;
  activeFilePath.value = null;
  showOpenSpecDialog.value = false;
  specDetailTarget.value = null;
  backend.startNewSession();
  router.push({ name: "chat" });
}

function onOpenChat() {
  activeDiff.value = null;
  activeFilePath.value = null;
  showOpenSpecDialog.value = false;
  specDetailTarget.value = null;
  // 正在探索 change 时,当前 selected session 是 stage session(工作流阶段会话),
  // 它按设计只应从工作流轨道进入,不能泄漏到 chat 视图。当 lastChatSessionId 为空
  // (如在 /workflow 刷新后)时,旧逻辑会带着 stage session 直接进 chat,导致阶段对话
  // 内容被展示。命中 stage session 或无可用会话时,开新会话而非沿用 stage session。
  const cur = backend.selectedSessionId.value;
  const onStageSession = Boolean(cur) && stageSessions.stageSessionIds.value.has(cur);
  if (lastChatSessionId.value && cur !== lastChatSessionId.value) {
    backend.selectSession(lastChatSessionId.value);
  } else if (onStageSession || !cur) {
    backend.startNewSession();
  }
  router.push({ name: "chat" });
}

function onOpenWorkflow(changeId?: string) {
  lastChatSessionId.value = backend.selectedSessionId.value;
  activeDiff.value = null;
  activeFilePath.value = null;
  showOpenSpecDialog.value = false;
  specDetailTarget.value = null;
  router.push({ name: "workflow", query: changeId ? { change: changeId } : {} });
}

function onOpenSpecDetail(target: SpecTarget) {
  specDetailTarget.value = target;
}

function onPickTier(tier: WorkflowTier) {
  lastChatSessionId.value = backend.selectedSessionId.value;
  showTierPicker.value = false;
  specDetailTarget.value = null;
  activeDiff.value = null;
  activeFilePath.value = null;
  wf.requestNewDraft(tier);
  router.push({ name: "workflow" });
}

function onOpenDiff(diff: MessageDiffEntry) {
  showOpenSpecDialog.value = false;
  specDetailTarget.value = null;
  activeDiff.value = diff;
}

function onOpenFile(path: string) {
  showOpenSpecDialog.value = false;
  specDetailTarget.value = null;
  // Tab behavior: dedupe by path, push if new, always activate. Mirrors
  // VSCode-style behavior: clicking a file in the explorer opens or focuses a tab.
  if (!openFiles.value.includes(path)) {
    openFiles.value = [...openFiles.value, path];
  }
  activeFilePath.value = path;
}

function onSelectFile(path: string) {
  activeFilePath.value = path;
}

function onCloseFile(path: string) {
  const idx = openFiles.value.indexOf(path);
  if (idx === -1) return;
  const next = openFiles.value.filter((p) => p !== path);
  openFiles.value = next;
  // If we closed the active tab, focus a neighbor (prefer right, fall back
  // left). When no tabs remain, drop back to chat.
  if (activeFilePath.value === path) {
    activeFilePath.value = next[Math.min(idx, next.length - 1)] ?? null;
  }
}

function onCloseAllFiles() {
  openFiles.value = [];
  activeFilePath.value = null;
}

function onCloseDiff() {
  activeDiff.value = null;
}

function toggleConsole() {
  showConsole.value = !showConsole.value;
  if (showConsole.value) {
    nextTick(() => consolePanelEl.value?.focus());
  }
}

async function handleOpenFolder() {
  // Electron: trigger the native picker, then load the tree + jump to chat.
  if (inElectron) {
    const dir = await selectDirectory();
    if (!dir) return;
    project.openDirectoryPath(dir);
    router.push({ name: "chat" });
    return;
  }
  // Browser: try File System Access API (Chrome/Edge)
  if ("showDirectoryPicker" in window) {
    try {
      const handle = await window.showDirectoryPicker?.({ mode: "read" });
      if (!handle) throw new Error("No directory selected");
      await project.openDirectoryHandle(handle);
      router.push({ name: "chat" });
      return;
    } catch {
      // User cancelled or not allowed
    }
  }
  // Fallback: show manual input dialog
  showProjectDialog.value = true;
}

function submitManualPath() {
  const path = manualPath.value.trim();
  if (!path) return;
  project.openDirectoryPath(path);
  showProjectDialog.value = false;
  manualPath.value = "";
  router.push({ name: "chat" });
}
</script>

<template>
  <div class="flex flex-col h-screen bg-surface-950 text-surface-100 overflow-hidden">
    <!-- Top Bar -->
    <TopBar
      :console-active="showConsole"
      @toggle-settings="showSettings = !showSettings"
      @toggle-help="showHelp = !showHelp"
      @toggle-console="toggleConsole"
      @open-folder="handleOpenFolder"
    />

    <!-- Main Content -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Side Panel -->
      <SidePanel
        :style="{ width: `${sidePanelWidth}px` }"
        class="flex-shrink-0 border-r border-surface-800"
        :sessions="backend.sessions.value"
        :active-session-id="backend.selectedSessionId.value"
        :workspace-diffs="backend.workspaceDiffs.value"
        :status-of="backend.statusOf"
        :spec-detail-target="specDetailTarget"
        @select-session="onSelectSession"
        @delete-session="onDeleteSession"
        @delete-workflow-draft="onDeleteWorkflowDraft"
        @delete-active-change="onDeleteActiveChange"
        @abort-session="onAbortSession"
        @new-session="onNewSession"
        @open-chat="onOpenChat"
        @open-diff="onOpenDiff"
        @open-file="onOpenFile"
        @open-folder="handleOpenFolder"
        @open-workflow="onOpenWorkflow"
        @open-spec-detail="onOpenSpecDetail"
        @open-tier-picker="showTierPicker = true"
        @refresh-files="onRefreshFiles"
      />
      <!-- Sidebar drag handle -->
      <div
        class="group relative w-1 flex-shrink-0 cursor-col-resize bg-surface-800/40 transition-colors hover:bg-accent-cyan/40"
        :class="sidebarResize.isDragging.value ? '!bg-accent-cyan/60' : ''"
        title="??????"
        @pointerdown="sidebarResize.start"
      >
        <div class="absolute inset-y-0 -left-1 -right-1" />
      </div>

      <!-- Center Content: chat OR diff comparison (mutually exclusive) -->
      <main class="flex-1 flex flex-col overflow-hidden min-w-0">
        <template v-if="specDetailTarget">
          <SpecDetailView
            :target="specDetailTarget"
            @close="specDetailTarget = null"
            @navigate="onOpenSpecDetail"
            @open-workflow="onOpenWorkflow"
          />
        </template>
        <template v-else-if="activeDiff">
          <div class="diff-toolbar">
            <span class="diff-toolbar-title" :title="activeDiff.file">
              {{ activeDiff.file }}
            </span>
            <button type="button" class="diff-toolbar-close" title="??????" @click="onCloseDiff">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div class="diff-main">
            <DiffViewer :diff="activeDiff" />
          </div>
        </template>
        <template v-else-if="activeFilePath">
          <!-- File tabs strip + content -->
          <div class="flex items-center gap-0.5 border-b border-surface-800 bg-surface-900 px-1">
            <button
              v-for="p in openFiles"
              :key="p"
              type="button"
              class="group relative flex max-w-[200px] items-center gap-1.5 truncate px-3 py-2 text-xs transition-colors"
              :class="
                p === activeFilePath
                  ? 'bg-surface-950 text-surface-100'
                  : 'text-surface-400 hover:bg-surface-800/50 hover:text-surface-200'
              "
              :title="p"
              @click="onSelectFile(p)"
            >
              <span
                class="absolute left-0 top-0 h-0.5 w-full"
                :class="p === activeFilePath ? 'bg-accent-cyan' : 'bg-transparent'"
              />
              <span class="truncate">{{ p.split(/[\\/]/).pop() || p }}</span>
              <span
                class="rounded p-0.5 text-surface-500 opacity-0 transition-opacity hover:bg-surface-700 hover:text-surface-100 group-hover:opacity-100"
                :class="{ '!opacity-100': p === activeFilePath }"
                title="??"
                @click.stop="onCloseFile(p)"
              >
                <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </span>
            </button>
            <button
              type="button"
              class="ml-auto rounded px-2 py-1 text-xs text-surface-500 transition-colors hover:bg-surface-800 hover:text-surface-200"
              title="??????"
              @click="onCloseAllFiles"
            >
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          <div class="flex-1 overflow-hidden">
            <FileViewer
              :key="activeFilePath"
              :path="activeFilePath"
              :directory="project.state.directoryPath"
            />
          </div>
        </template>
        <template v-else>
          <router-view v-slot="{ Component }">
            <keep-alive>
              <component :is="Component" @navigate-session="onSelectSession" />
            </keep-alive>
          </router-view>
          <InputPanel v-if="isChatRoute()" />
        </template>
      </main>
    </div>

    <!-- Console Panel (toggleable, sits above the status bar) -->
    <ConsolePanel
      v-if="showConsole"
      ref="consolePanelEl"
      :cwd="project.state.directoryPath"
      v-model:height="consoleHeight"
      class="flex-shrink-0"
      @minimize="showConsole = false"
    />

    <!-- Status Bar -->
    <StatusBar />

    <!-- Settings Modal -->
    <SettingsPanel v-model="showSettings" />
    <!-- Help / quick-start carousel -->
    <HelpModal v-model="showHelp" />
    <!-- Auto-updater global toast -->
    <UpdateToast />
    <!-- Auto-updater prompt dialog (available/progress/downloaded) -->
    <UpdateDialog />
    <!-- 新建探索:档位选择对话框 -->
    <TierPickerDialog :open="showTierPicker" @pick="onPickTier" @close="showTierPicker = false" />
    <ConfirmDialog ref="confirmDialog" />
    <!-- OpenSpec Dialog -->
    <Teleport to="body">
      <div v-if="showOpenSpecDialog" class="openspec-dialog-layer">
        <div class="openspec-dialog-backdrop" @click="showOpenSpecDialog = false" />
        <section class="openspec-dialog" role="dialog" aria-modal="true" aria-label="OpenSpec">
          <header class="openspec-dialog-header">
            <div class="openspec-dialog-title-group">
              <span class="openspec-dialog-title">OpenSpec</span>
              <span class="openspec-dialog-subtitle">Spec workflow</span>
            </div>
            <button
              type="button"
              class="openspec-dialog-close"
              title="Close OpenSpec"
              @click="showOpenSpecDialog = false"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>
          <div class="openspec-dialog-body">
            <OpenSpecPanel variant="dialog" />
          </div>
        </section>
      </div>
    </Teleport>

    <!-- Floating Window Overlay (tool-call windows) -->
    <div class="fixed inset-0 pointer-events-none" style="z-index: 9999">
      <FloatingWindow
        v-for="entry in floatingEntries"
        :key="entry.key"
        :entry="entry"
        :manager="fw"
        @focus="onWindowFocus"
        @close="onWindowClose"
      />
    </div>

    <!-- Manual path dialog (browser fallback for Open Project) -->
    <Teleport to="body">
      <div
        v-if="showProjectDialog"
        class="fixed inset-0 z-[10000] flex items-center justify-center"
      >
        <div class="absolute inset-0 bg-black/60" @click="showProjectDialog = false" />
        <div
          class="relative w-full max-w-sm bg-surface-900 border border-surface-700 rounded-xl shadow-2xl p-5"
        >
          <h3 class="text-sm font-semibold text-surface-200 mb-3">Open Project</h3>
          <input
            v-model="manualPath"
            type="text"
            placeholder="/path/to/project"
            class="w-full px-3 py-2 text-sm rounded-lg bg-surface-800 border border-surface-700 text-surface-100 placeholder:text-surface-600 focus:outline-none focus:border-accent-cyan/50 mb-3"
            @keydown.enter="submitManualPath"
          />
          <div class="flex justify-end gap-2">
            <button
              class="px-3 py-1.5 text-xs rounded-lg bg-surface-800 text-surface-400 hover:text-surface-200 transition-colors"
              @click="showProjectDialog = false"
            >
              Cancel
            </button>
            <button
              class="px-3 py-1.5 text-xs rounded-lg bg-accent-cyan/15 text-accent-cyan hover:bg-accent-cyan/25 transition-colors disabled:opacity-30"
              :disabled="!manualPath.trim()"
              @click="submitManualPath"
            >
              Open
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.diff-toolbar {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.6rem;
  background: color-mix(in srgb, var(--color-surface-900, #0f172a) 90%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 70%, transparent);
  flex: 0 0 auto;
}

.diff-toolbar-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--color-surface-200, #e2e8f0);
}

.diff-toolbar-close {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--color-surface-500, #64748b);
  cursor: pointer;
}

.diff-toolbar-close:hover {
  background: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 22%, transparent);
  color: var(--color-accent-rose, #f43f5e);
}

.diff-main {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.openspec-dialog-layer {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 34px;
}

.openspec-dialog-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(2, 6, 23, 0.68);
}

.openspec-dialog {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(1120px, calc(100vw - 68px));
  height: min(780px, calc(100vh - 68px));
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 76%, transparent);
  border-radius: 8px;
  background: var(--color-surface-950, #020617);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.46);
}

.openspec-dialog-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px 11px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 78%, transparent);
  background: color-mix(in srgb, var(--color-surface-900, #0f172a) 86%, transparent);
}

.openspec-dialog-title-group {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.openspec-dialog-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-surface-100, #f1f5f9);
}

.openspec-dialog-subtitle {
  font-size: 11px;
  color: var(--color-surface-500, #64748b);
}

.openspec-dialog-close {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--color-surface-500, #64748b);
  cursor: pointer;
}

.openspec-dialog-close:hover {
  background: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 18%, transparent);
  color: var(--color-accent-rose, #f43f5e);
}

.openspec-dialog-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
