<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import TopBar from "./components/TopBar.vue";
import SidePanel from "./components/SidePanel.vue";
import SpecDrawer from "./components/SpecDrawer.vue";
import StatusBar from "./components/StatusBar.vue";
import InputPanel from "./components/InputPanel.vue";
import FloatingWindow from "./components/FloatingWindow.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import ConsolePanel from "./components/ConsolePanel.vue";
import FileViewer from "./components/FileViewer.vue";
import SessionDiffPanel from "./components/SessionDiffPanel.vue";
import OpenSpecPanel from "./components/openspec/OpenSpecPanel.vue";
import SpecDetailView from "./components/openspec/SpecDetailView.vue";
import TierPickerDialog from "./components/workflow/TierPickerDialog.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import MarkdownArtifactModal from "./components/MarkdownArtifactModal.vue";
import UpdateToast from "./components/UpdateToast.vue";
import UpdateDialog from "./components/UpdateDialog.vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useFloatingWindows } from "./composables/useFloatingWindows";
import { useProject } from "./composables/useProject";
import { useBackend } from "./composables/useBackend";
import { computeHiddenStageSessions } from "./utils/stageTitleEncoding";
import { useOpenSpec } from "./composables/useOpenSpec";
import { useStageSessions } from "./composables/useStageSessions";
import { useWorkflow } from "./plugins/workflowPlugin";
import { useResizable } from "./composables/useResizable";
import { useDiffPanel } from "./composables/useDiffPanel";
import { isElectron, onOpenFolder, selectDirectory } from "./utils/electronBridge";
import type { SpecTarget } from "./types/openspec";
import type { WorkflowTier } from "./types/workflow";

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

// Sidebar drag-resize: clamp to [200, 600], persist to localStorage. The
// `resize-active` body class (added by the composable during drag) disables
// text selection so the gesture feels solid.
const sidebarResize = useResizable({
  orientation: "horizontal",
  storageKey: "sidebar.width",
  defaultSize: 260,
  min: 200,
  max: 600,
});
const sidePanelWidth = sidebarResize.size;
const sidePanelCollapsed = ref(false);
const effectiveSidePanelWidth = computed(() =>
  sidePanelCollapsed.value ? 0 : sidePanelWidth.value,
);
const showSettings = ref(false);
const showConsole = ref(false);
const showSpecDrawer = ref(false);
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

const { showDiffPanel, activeView, setActiveView } = useDiffPanel();
const diffColumnVisible = computed(
  () => isChatRoute() && !specDetailTarget.value && !activeFilePath.value,
);

// Floating window system (kept for tool-call streaming windows)
const fw = useFloatingWindows();
const floatingEntries = fw.entries;

function updateExtent() {
  fw.setExtent(window.innerWidth, window.innerHeight);
}

// Currently-open file in the FileViewer modal. Set when the user clicks a
// file entry in the Files tree (the `open-file` event bubbles up through
// SidePanel). Cleared by closing the modal.
const openFiles = ref<string[]>([]);
const activeFilePath = ref<string | null>(null);

// Remember the chat session before entering workflow so returning to chat
// restores it instead of surfacing the workflow's stage session (crosstalk).
const lastChatSessionId = ref("");

const project = useProject();
const openspec = useOpenSpec();
const wf = useWorkflow();
const stageSessions = useStageSessions();
let unsubOpenFolder: (() => void) | null = null;

watch(
  () => project.state.directoryPath,
  (newPath) => {
    if (newPath) openspec.scheduleRefresh(100);
  },
);

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
  window.addEventListener("keydown", onKeyDown);
  unsubOpenFolder = onOpenFolder((dirPath) => {
    project.openDirectoryPath(dirPath);
    router.push({ name: "chat" });
  });
  project.restoreLastSession();
});

function onKeyDown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "s") {
    e.preventDefault();
    showSpecDrawer.value = !showSpecDrawer.value;
  }
  if (e.key === "Escape" && showSpecDrawer.value) {
    showSpecDrawer.value = false;
  }
}

onUnmounted(() => {
  window.removeEventListener("resize", updateExtent);
  window.removeEventListener("focus", onFocusRefresh);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("keydown", onKeyDown);
  unsubOpenFolder?.();
});

function onWindowFocus(key: string) {
  fw.bringToFront(key);
}

function onWindowClose(key: string) {
  fw.close(key);
}

async function onSelectSession(sessionId: string) {
  activeFilePath.value = null;
  showOpenSpecDialog.value = false;
  specDetailTarget.value = null;

  const session = backend.sessions.value.find((s) => s.id === sessionId);
  if (session?.directory) {
    const norm = (p: string) => p.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    const sessionDir = session.directory;
    const currentDir = project.state.directoryPath;
    if (currentDir && norm(currentDir) !== norm(sessionDir)) {
      project.switchProject(sessionDir);
      await nextTick();
    }
  }

  backend.selectSession(sessionId);
  router.push({ name: "chat" });
}

async function onDeleteSession(sessionId: string) {
  if (!sessionId) return;
  const confirmed = await confirmDialog.value?.confirm({
    title: t("sidebar.deleteSessionConfirmTitle"),
    message: t("sidebar.deleteSessionConfirmMessage"),
    confirmText: t("sidebar.deleteSessionConfirm"),
    cancelText: t("sidebar.deleteSessionCancel"),
    danger: true,
  });
  if (!confirmed) return;
  try {
    await backend.deleteSession(sessionId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[App] deleteSession(${sessionId}) failed:`, error);
    await confirmDialog.value?.confirm({
      title: t("sidebar.deleteSessionFailedTitle"),
      message: reason,
      confirmText: t("sidebar.deleteSessionFailedConfirm"),
      cancelText: t("sidebar.deleteSessionCancel"),
      danger: true,
    });
  }
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
  activeFilePath.value = null;
  showOpenSpecDialog.value = false;
  specDetailTarget.value = null;
  backend.startNewSession();
  router.push({ name: "chat" });
}

function isWorkflowStageSession(sessionId: string): boolean {
  if (!sessionId) return false;
  return computeHiddenStageSessions(
    backend.sessions.value,
    stageSessions.stageSessionIds.value,
  ).has(sessionId);
}

function ensureChatDoesNotShowWorkflowSession(): void {
  const cur = backend.selectedSessionId.value;
  const last = lastChatSessionId.value;
  const canRestoreLast =
    Boolean(last) &&
    backend.sessions.value.some((session) => session.id === last) &&
    !isWorkflowStageSession(last);

  if (canRestoreLast && cur !== last) {
    backend.selectSession(last);
    return;
  }

  if (isWorkflowStageSession(cur) || !cur) {
    backend.startNewSession();
  }
}

watch(
  () => route.name,
  (name) => {
    if (name === "chat") ensureChatDoesNotShowWorkflowSession();
  },
  { flush: "post" },
);

function onOpenChat() {
  activeFilePath.value = null;
  showOpenSpecDialog.value = false;
  specDetailTarget.value = null;
  // 正在探索 change 时,当前 selected session 是 stage session(工作流阶段会话),
  // 它按设计只应从工作流轨道进入,不能泄漏到 chat 视图。当 lastChatSessionId 为空
  // (如在 /workflow 刷新后)时,旧逻辑会带着 stage session 直接进 chat,导致阶段对话
  // 内容被展示。命中 stage session 或无可用会话时,开新会话而非沿用 stage session。
  // 同样适用于 stage session 的子 agent(沿祖先链查找),共用 computeHiddenStageSessions。
  ensureChatDoesNotShowWorkflowSession();
  router.push({ name: "chat" });
}

function onShowHome(dirPath: string) {
  project.switchProject(dirPath);
  router.push({ name: "home" });
}

function onOpenWorkflow(changeId?: string, intro = false) {
  lastChatSessionId.value = backend.selectedSessionId.value;
  activeFilePath.value = null;
  showOpenSpecDialog.value = false;
  specDetailTarget.value = null;
  // 点击 spec 探索轨道按钮(无 changeId)时强制 intro=1,防止 keep-alive 缓存的
  // 草稿工作流状态在主区自动续上 —— 用户想真正续草稿需点击"探索中"草稿项。
  const query: Record<string, string> = {};
  if (changeId) query.change = changeId;
  else if (intro) query.intro = "1";
  router.push({ name: "workflow", query });
}

function onOpenSpecDetail(target: SpecTarget) {
  specDetailTarget.value = target;
}

function onPickTier(tier: WorkflowTier) {
  lastChatSessionId.value = backend.selectedSessionId.value;
  showTierPicker.value = false;
  specDetailTarget.value = null;
  activeFilePath.value = null;
  wf.requestNewDraft(tier);
  router.push({ name: "workflow" });
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
      :settings-active="showSettings"
      :sidebar-collapsed="sidePanelCollapsed"
      @toggle-settings="showSettings = !showSettings"
      @toggle-console="toggleConsole"
      @toggle-sidebar="sidePanelCollapsed = !sidePanelCollapsed"
    />

    <!-- Main Content -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Side Panel -->
      <SidePanel
        :style="{ width: `${effectiveSidePanelWidth}px` }"
        class="flex-shrink-0 border-r border-surface-800"
        :sessions="backend.sessions.value"
        :active-session-id="backend.selectedSessionId.value"
        :status-of="backend.statusOf"
        :spec-detail-target="specDetailTarget"
        @select-session="onSelectSession"
        @delete-session="onDeleteSession"
        @delete-workflow-draft="onDeleteWorkflowDraft"
        @delete-active-change="onDeleteActiveChange"
        @abort-session="onAbortSession"
        @new-session="onNewSession"
        @open-chat="onOpenChat"
        @show-home="onShowHome"
        @open-folder="handleOpenFolder"
        @open-workflow="onOpenWorkflow"
        @open-spec-detail="onOpenSpecDetail"
        @open-tier-picker="showTierPicker = true"
      />
      <!-- Sidebar drag handle -->
      <div
        v-if="!sidePanelCollapsed"
        class="group relative w-1 flex-shrink-0 cursor-col-resize bg-surface-800/40 transition-colors hover:bg-accent-cyan/40"
        :class="sidebarResize.isDragging.value ? '!bg-accent-cyan/60' : ''"
        title="??????"
        @pointerdown="sidebarResize.start"
      >
        <div class="absolute inset-y-0 -left-1 -right-1" />
      </div>

      <!-- Center Content: chat OR file viewer (mutually exclusive) -->
      <main class="flex-1 flex overflow-hidden min-w-0">
        <div class="flex-1 flex flex-col overflow-hidden min-w-0">
          <template v-if="specDetailTarget">
            <SpecDetailView
              :target="specDetailTarget"
              @close="specDetailTarget = null"
              @navigate="onOpenSpecDetail"
              @open-workflow="onOpenWorkflow"
            />
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
        </div>
        <!-- View sidebar (right column, full main height) -->
        <div
          class="diff-column"
          :class="{ 'diff-column-hidden': !showDiffPanel || !diffColumnVisible }"
        >
          <!-- Selection screen: shown when no view is active -->
          <div v-if="activeView === null" class="view-selector">
            <button type="button" class="view-selector-btn" @click="setActiveView('diff')">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="9" y1="10" x2="15" y2="10" />
                <line x1="12" y1="7" x2="12" y2="13" />
                <line x1="9" y1="17" x2="15" y2="17" />
              </svg>
              <div class="view-selector-label">
                <span class="view-selector-name">审查</span>
                <span class="view-selector-desc">查看当前工作目录中的代码变更</span>
              </div>
            </button>
            <button type="button" class="view-selector-btn" @click="setActiveView('console')">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M7 9l3 3-3 3" />
                <line x1="13" y1="15" x2="17" y2="15" />
              </svg>
              <div class="view-selector-label">
                <span class="view-selector-name">终端</span>
                <span class="view-selector-desc">在项目目录中运行终端命令</span>
              </div>
            </button>
          </div>

          <!-- View content -->
          <template v-else>
            <SessionDiffPanel
              v-if="activeView === 'diff'"
              :session-id="backend.selectedSessionId.value || ''"
              :visible="diffColumnVisible && showDiffPanel && activeView === 'diff'"
              @back="setActiveView(null)"
              @close="showDiffPanel = false"
            />
            <ConsolePanel
              v-if="activeView === 'console'"
              :cwd="project.state.directoryPath"
              fill
              @minimize="setActiveView(null)"
              @close="
                showDiffPanel = false;
                activeView = null;
              "
            />
          </template>
        </div>
      </main>
    </div>

    <!-- Console Panel (bottom, hidden when sidebar console is active) -->
    <ConsolePanel
      v-if="showConsole && !(showDiffPanel && activeView === 'console')"
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
    <!-- Auto-updater global toast -->
    <UpdateToast />
    <!-- Auto-updater prompt dialog (available/progress/downloaded) -->
    <UpdateDialog />
    <!-- 新建探索:档位选择对话框 -->
    <TierPickerDialog :open="showTierPicker" @pick="onPickTier" @close="showTierPicker = false" />
    <ConfirmDialog ref="confirmDialog" />
    <MarkdownArtifactModal />
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

    <!-- Spec Drawer FAB + Drawer -->
    <Teleport to="body">
      <button
        v-if="project.state.directoryPath && !sidePanelCollapsed"
        class="spec-fab"
        :style="showConsole ? { bottom: `${56 + consoleHeight}px` } : {}"
        title="Spec 探索 (Ctrl+Shift+S)"
        @click="showSpecDrawer = true"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.74V16h8v-1.26A7 7 0 0 0 12 2z" />
        </svg>
      </button>
    </Teleport>

    <SpecDrawer
      :open="showSpecDrawer"
      :spec-detail-target="specDetailTarget"
      :console-panel-height="showConsole ? consoleHeight : 0"
      @close="showSpecDrawer = false"
      @open-workflow="onOpenWorkflow"
      @open-spec-detail="onOpenSpecDetail"
      @open-tier-picker="showTierPicker = true"
      @delete-workflow-draft="onDeleteWorkflowDraft"
      @delete-active-change="onDeleteActiveChange"
    />

    <!-- Manual path dialog (browser fallback for Open Project) -->
    <Teleport to="body">
      <div
        v-if="showProjectDialog"
        class="fixed inset-0 z-[10000] flex items-center justify-center overflow-auto"
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
.diff-column {
  width: clamp(440px, 36vw, 600px);
  flex-shrink: 0;
  border-left: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 60%, transparent);
  overflow: hidden;
  contain: layout paint;
  transition:
    width 0.2s ease,
    opacity 0.2s ease;
  display: flex;
  flex-direction: column;
}
.diff-column-hidden {
  width: 0;
  opacity: 0;
  border-left-width: 0;
}

.view-selector {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  position: relative;
  background: color-mix(in srgb, var(--color-surface-950, #020617) 80%, transparent);
}

.view-selector-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 280px;
  padding: 16px 20px;
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 50%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-surface-900, #0f172a) 60%, transparent);
  color: var(--color-surface-400, #94a3b8);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease,
    transform 0.1s ease;
}
.view-selector-btn:hover {
  border-color: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 40%, transparent);
  background: color-mix(
    in srgb,
    var(--color-accent-cyan, #22d3ee) 8%,
    var(--color-surface-900, #0f172a)
  );
  color: var(--color-accent-cyan, #22d3ee);
}
.view-selector-btn:active {
  transform: scale(0.97);
}
.view-selector-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
}
.view-selector-name {
  font-size: 13px;
  font-weight: 600;
}
.view-selector-desc {
  font-size: 10px;
  color: var(--color-surface-500, #64748b);
  line-height: 1.3;
}

.openspec-dialog-layer {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 34px;
  overflow: auto;
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
  overflow-y: auto;
}

.spec-fab {
  position: fixed;
  bottom: 56px;
  left: 16px;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--color-accent-violet, #a78bfa) 35%, transparent);
  background: color-mix(
    in srgb,
    var(--color-accent-violet, #a78bfa) 14%,
    var(--color-surface-900, #0f172a)
  );
  color: var(--color-accent-violet, #a78bfa);
  cursor: pointer;
  box-shadow: 0 4px 24px color-mix(in srgb, var(--color-accent-violet, #a78bfa) 20%, transparent);
  transition: all 0.2s;
  z-index: 8000;
}

.spec-fab:hover {
  transform: scale(1.06);
  box-shadow: 0 6px 32px color-mix(in srgb, var(--color-accent-violet, #a78bfa) 30%, transparent);
}

.spec-fab svg {
  width: 20px;
  height: 20px;
  stroke-width: 1.8;
}
</style>
