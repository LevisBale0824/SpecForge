<script setup lang="ts">
import { computed, watch } from "vue";
import { useOpenSpec } from "../composables/useOpenSpec";
import { useProject } from "../composables/useProject";
import { useWorkflow } from "../plugins/workflowPlugin";
import { useRoute } from "vue-router";
import type { SpecTarget } from "../types/openspec";

const openspec = useOpenSpec();
const project = useProject();
const wf = useWorkflow();
const route = useRoute();

const props = defineProps<{
  open: boolean;
  specDetailTarget?: SpecTarget | null;
}>();

const emit = defineEmits<{
  close: [];
  "open-workflow": [changeId?: string, intro?: boolean];
  "open-spec-detail": [target: SpecTarget];
  "open-tier-picker": [];
  "delete-workflow-draft": [];
  "delete-active-change": [changeId: string];
}>();

const displayWorkflowTitle = computed(() => wf.state.value.label?.trim() || "探索中...");
const hasWorkflowDraft = computed(() => Boolean(wf.state.value.label?.trim()));
const selectedChangeId = computed(() => (route.query.change as string | undefined) ?? "");

const selectedDetail = computed<{ kind: "archived" | "capability"; key: string } | null>(() => {
  const t = props.specDetailTarget;
  if (!t) return null;
  if (t.kind === "archived") return { kind: "archived", key: t.id };
  if (t.kind === "capability") return { kind: "capability", key: t.name };
  return null;
});

const badgeCount = computed(
  () => openspec.state.activeChanges.length + (hasWorkflowDraft.value ? 1 : 0),
);

const activeProjectName = computed(() => project.state.directoryName);

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && project.state.directoryPath) {
      openspec.scheduleRefresh(0);
    }
  },
);

watch(
  () => project.state.directoryPath,
  (newPath) => {
    if (props.open && newPath) {
      openspec.scheduleRefresh(0);
    }
  },
);
</script>

<template>
  <Teleport to="body">
    <Transition name="spec-drawer-fade">
      <div v-if="open" class="spec-drawer-overlay" @click="emit('close')"></div>
    </Transition>
    <Transition name="spec-drawer-slide">
      <aside v-if="open" class="spec-drawer">
        <header class="drawer-header">
          <div class="drawer-title-group">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-accent-violet, #a78bfa)"
            >
              <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.74V16h8v-1.26A7 7 0 0 0 12 2z" />
            </svg>
            <div class="drawer-title-stack">
              <span class="drawer-title">Spec 探索</span>
              <span class="drawer-project">{{ activeProjectName }}</span>
            </div>
            <span v-if="badgeCount > 0" class="drawer-badge">{{ badgeCount }}</span>
          </div>
          <button type="button" class="drawer-close" @click="emit('close')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div class="drawer-body">
          <button type="button" class="spec-new-btn" @click="emit('open-tier-picker')">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path
                d="M12 2.5l1.9 5.6a4 4 0 0 0 2 2l5.6 1.9-5.6 1.9a4 4 0 0 0-2 2L12 21.5l-1.9-5.6a4 4 0 0 0-2-2L2.5 12l5.6-1.9a4 4 0 0 0 2-2L12 2.5z"
              />
            </svg>
            <span>开始新的探索</span>
          </button>

          <div v-if="hasWorkflowDraft" class="spec-group">
            <div class="spec-group-label">探索中</div>
            <div class="spec-item-row ongoing" @click="emit('open-workflow')">
              <span class="spec-marker violet">◆</span>
              <span class="spec-id">{{ displayWorkflowTitle }}</span>
              <button type="button" class="spec-delete" @click.stop="emit('delete-workflow-draft')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M3 6h18M8 6V4h8v2M10 11v6M14 11v6M6 6l1 14h10l1-14" />
                </svg>
              </button>
            </div>
          </div>

          <div v-if="openspec.state.activeChanges.length" class="spec-group">
            <div class="spec-group-label">
              <span>活跃探索</span>
              <span class="spec-group-count">{{ openspec.state.activeChanges.length }}</span>
            </div>
            <div
              v-for="change in openspec.state.activeChanges"
              :key="change.id"
              class="spec-item-row"
              :class="{ selected: selectedChangeId === change.id }"
              @click="emit('open-workflow', change.id)"
            >
              <span class="spec-marker emerald"></span>
              <span class="spec-id">{{ change.id }}</span>
              <span v-if="change.taskStats?.total" class="spec-progress"
                >{{ change.taskStats.completed }}/{{ change.taskStats.total }}</span
              >
              <button
                type="button"
                class="spec-delete"
                @click.stop="emit('delete-active-change', change.id)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M3 6h18M8 6V4h8v2M10 11v6M14 11v6M6 6l1 14h10l1-14" />
                </svg>
              </button>
            </div>
          </div>

          <div v-if="openspec.state.archivedChanges.length" class="spec-group">
            <div class="spec-group-label">
              <span>已完成</span>
              <span class="spec-group-count">{{ openspec.state.archivedChanges.length }}</span>
            </div>
            <div
              v-for="change in openspec.state.archivedChanges"
              :key="`archived-${change.id}`"
              class="spec-item-row archived"
              :class="{
                selected: selectedDetail?.kind === 'archived' && selectedDetail.key === change.id,
              }"
              @click="emit('open-spec-detail', { kind: 'archived', id: change.id })"
            >
              <span class="spec-marker amber">✓</span>
              <span class="spec-id">{{ change.id }}</span>
              <span v-if="change.archivedAt" class="spec-progress">{{ change.archivedAt }}</span>
            </div>
          </div>

          <div v-if="openspec.state.capabilities.length" class="spec-group">
            <div class="spec-group-label">
              <span>现有能力</span>
              <span class="spec-group-count">{{ openspec.state.capabilities.length }}</span>
            </div>
            <div
              v-for="cap in openspec.state.capabilities"
              :key="cap.name"
              class="spec-item-row cap"
              :class="{
                selected: selectedDetail?.kind === 'capability' && selectedDetail.key === cap.name,
              }"
              @click="emit('open-spec-detail', { kind: 'capability', name: cap.name })"
            >
              <span class="spec-marker violet">◆</span>
              <span class="spec-id">{{ cap.name }}</span>
              <span v-if="cap.requirements?.length" class="spec-progress"
                >{{ cap.requirements.length }} reqs</span
              >
            </div>
          </div>

          <div
            v-if="
              !openspec.state.activeChanges.length &&
              !openspec.state.archivedChanges.length &&
              !openspec.state.capabilities.length &&
              !hasWorkflowDraft
            "
            class="spec-empty"
          >
            暂无探索记录
          </div>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.spec-drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  background: rgba(2, 6, 17, 0.5);
  backdrop-filter: blur(2px);
}

.spec-drawer {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: min(340px, calc(100vw - 40px));
  z-index: 9001;
  display: flex;
  flex-direction: column;
  background: var(--color-surface-900, #0f172a);
  border-right: 1px solid var(--color-surface-700, #334155);
  box-shadow: 8px 0 32px rgba(0, 0, 0, 0.4);
}

.drawer-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--color-surface-800, #1e293b);
  flex-shrink: 0;
}

.drawer-title-group {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.drawer-title-stack {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.drawer-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-surface-100, #f1f5f9);
}

.drawer-project {
  font-size: 10px;
  color: var(--color-surface-500, #64748b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.drawer-badge {
  padding: 1px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 20%, transparent);
  color: var(--color-accent-violet, #a78bfa);
  font-size: 10px;
  font-weight: 700;
}

.drawer-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-surface-500, #64748b);
  cursor: pointer;
  transition: all 0.12s;
}

.drawer-close:hover {
  color: var(--color-accent-rose, #f43f5e);
  background: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 12%, transparent);
}

.drawer-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 10px 12px 16px;
}

.spec-new-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 12px;
  margin-bottom: 10px;
  border: 1px dashed color-mix(in srgb, var(--color-accent-violet, #a78bfa) 45%, transparent);
  border-radius: 10px;
  background: transparent;
  color: var(--color-accent-violet, #a78bfa);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.spec-new-btn:hover {
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 10%, transparent);
  border-color: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 70%, transparent);
}

.spec-new-btn svg {
  width: 14px;
  height: 14px;
}

.spec-group {
  margin-bottom: 6px;
}

.spec-group-label {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 4px 4px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-surface-500, #64748b);
}

.spec-group-count {
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-surface-600, #475569) 30%, transparent);
  color: var(--color-surface-400, #94a3b8);
  font-size: 9px;
  font-weight: 700;
}

.spec-item-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.1s;
}

.spec-item-row:hover {
  background: color-mix(in srgb, var(--color-surface-800, #1e293b) 60%, transparent);
}

.spec-item-row.selected {
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 10%, transparent);
}

.spec-item-row.ongoing {
  color: var(--color-accent-violet, #a78bfa);
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 6%, transparent);
}

.spec-marker {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 800;
}

.spec-marker.emerald {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-accent-emerald, #34d399);
  box-shadow: 0 0 6px color-mix(in srgb, var(--color-accent-emerald, #34d399) 60%, transparent);
}

.spec-marker.violet {
  color: var(--color-accent-violet, #a78bfa);
}

.spec-marker.amber {
  color: var(--color-accent-amber, #f59e0b);
}

.spec-id {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-family: var(--font-mono, "SF Mono", monospace);
  color: var(--color-surface-300, #cbd5e1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.spec-item-row.selected .spec-id {
  color: var(--color-accent-violet, #a78bfa);
}

.spec-progress {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--color-surface-500, #64748b);
  font-variant-numeric: tabular-nums;
}

.spec-delete {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-surface-600, #475569);
  cursor: pointer;
  opacity: 0;
  transition: all 0.1s;
}

.spec-item-row:hover .spec-delete {
  opacity: 1;
}

.spec-delete:hover {
  color: var(--color-accent-rose, #f43f5e);
  background: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 12%, transparent);
}

.spec-delete svg {
  width: 12px;
  height: 12px;
  stroke-width: 2;
}

.spec-empty {
  padding: 32px 16px;
  text-align: center;
  font-size: 12px;
  color: var(--color-surface-600, #475569);
}

/* ── Transitions ── */
.spec-drawer-fade-enter-active,
.spec-drawer-fade-leave-active {
  transition: opacity 0.2s ease;
}
.spec-drawer-fade-enter-from,
.spec-drawer-fade-leave-to {
  opacity: 0;
}

.spec-drawer-slide-enter-active,
.spec-drawer-slide-leave-active {
  transition: transform 0.25s cubic-bezier(0.32, 0.72, 0, 1);
}
.spec-drawer-slide-enter-from,
.spec-drawer-slide-leave-to {
  transform: translateX(-100%);
}
</style>
