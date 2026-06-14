<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useOpenSpec } from "../../composables/useOpenSpec";
import { useProject } from "../../composables/useProject";
import OpenSpecChangeDetail from "./OpenSpecChangeDetail.vue";

const { t } = useI18n();
const { state, refresh, toggleTask, runValidate, init } = useOpenSpec();
const project = useProject();

const expanded = ref<Record<string, boolean>>({});
const toggling = ref<Record<string, boolean>>({});
const validating = ref<Record<string, boolean>>({});
const enabling = ref(false);
const enableMessage = ref<{ kind: "success" | "error"; text: string } | null>(null);

function toggleExpand(id: string) {
  expanded.value[id] = !expanded.value[id];
}

async function handleEnable() {
  enabling.value = true;
  enableMessage.value = null;
  try {
    const result = await init();
    if (result.ok) {
      enableMessage.value = {
        kind: "success",
        text:
          result.method === "cli"
            ? t("openspec.enableSuccessCli")
            : t("openspec.enableSuccessManual"),
      };
    } else {
      enableMessage.value = {
        kind: "error",
        text: result.reason
          ? `${t("openspec.enableFailed")}: ${result.reason}`
          : t("openspec.enableFailed"),
      };
    }
  } finally {
    enabling.value = false;
    // 3 秒后清空提示
    window.setTimeout(() => {
      enableMessage.value = null;
    }, 3000);
  }
}

async function handleToggleTask(changeId: string, taskId: string, completed: boolean) {
  toggling.value[changeId] = true;
  try {
    await toggleTask(changeId, taskId, completed);
  } finally {
    toggling.value[changeId] = false;
  }
}

async function handleValidate(changeId: string) {
  validating.value[changeId] = true;
  try {
    await runValidate(changeId);
  } finally {
    validating.value[changeId] = false;
  }
}

function progressPct(stats: { progress: number }): number {
  return Math.round(stats.progress * 100);
}
</script>

<template>
  <div class="openspec-panel">
    <!-- Loading / error / empty -->
    <div v-if="state.loading" class="state-line">
      {{ t("openspec.loading") }}
    </div>
    <div
      v-else-if="!project.state.directoryPath && !project.state.rootHandle"
      class="state-line empty"
    >
      {{ t("openspec.notConnected") }}
    </div>
    <div v-else-if="!state.initialized" class="state-line empty">
      <div>{{ t("openspec.empty") }}</div>
      <div class="hint">{{ t("openspec.emptyHint") }}</div>
      <button class="enable-btn" :disabled="enabling" @click="handleEnable">
        {{ enabling ? t("openspec.enabling") : t("openspec.enable") }}
      </button>
      <div v-if="enableMessage" class="enable-message" :class="enableMessage.kind">
        {{ enableMessage.text }}
      </div>
    </div>
    <div v-else-if="state.error" class="state-line error">
      {{ state.error }}
    </div>

    <template v-else>
      <!-- 概览 -->
      <div class="overview">
        <span class="overview-item"> {{ state.activeChanges.length }} active </span>
        <span class="overview-sep">·</span>
        <span class="overview-item">
          {{ t("openspec.capabilitiesCount", { count: state.capabilities.length }) }}
        </span>
        <span v-if="state.archivedChanges.length" class="overview-sep">·</span>
        <span v-if="state.archivedChanges.length" class="overview-item">
          {{ t("openspec.archivedCount", { count: state.archivedChanges.length }) }}
        </span>
        <button
          class="refresh-btn"
          :disabled="state.loading"
          :title="t('openspec.refresh')"
          @click="refresh()"
        >
          ↻
        </button>
      </div>

      <!-- Changes 列表 -->
      <div v-if="!state.activeChanges.length" class="state-line empty">
        {{ t("openspec.noActiveChanges") }}
      </div>
      <div v-else class="change-list">
        <div v-for="change in state.activeChanges" :key="change.id" class="change-item">
          <!-- 折叠头 -->
          <button class="change-head" @click="toggleExpand(change.id)">
            <span class="caret">{{ expanded[change.id] ? "▾" : "▸" }}</span>
            <span class="change-id">{{ change.id }}</span>
            <div
              class="mini-progress"
              :title="`${change.taskStats.completed}/${change.taskStats.total}`"
            >
              <div class="mini-fill" :style="{ width: `${progressPct(change.taskStats)}%` }" />
            </div>
            <span class="mini-progress-text"
              >{{ change.taskStats.completed }}/{{ change.taskStats.total }}</span
            >
            <span
              v-if="state.validation[change.id]"
              class="validation-mark"
              :class="state.validation[change.id].passed ? 'is-passed' : 'is-failed'"
            >
              {{ state.validation[change.id].passed ? "✓" : "✗" }}
            </span>
          </button>

          <!-- 详情(展开) -->
          <div v-if="expanded[change.id]" class="change-detail-wrap">
            <OpenSpecChangeDetail
              :change="change"
              :validation="state.validation[change.id]"
              :cli-unavailable="!state.cliAvailable"
              :toggling="toggling[change.id]"
              @toggle-task="(taskId, done) => handleToggleTask(change.id, taskId, done)"
              @validate="handleValidate(change.id)"
            />
            <div v-if="validating[change.id]" class="validating-hint">
              {{ t("openspec.validating") }}
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.openspec-panel {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 4px;
}

.state-line {
  padding: 8px 6px;
  color: var(--color-surface-400, #94a3b8);
}

.state-line.empty {
  text-align: center;
}

.state-line.empty .hint {
  margin-top: 4px;
  font-size: 10px;
  color: var(--color-surface-600, #475569);
}

.enable-btn {
  margin-top: 10px;
  padding: 5px 14px;
  background: var(--color-accent-cyan, #22d3ee);
  color: var(--color-surface-900, #0f172a);
  border: none;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}

.enable-btn:hover:not(:disabled) {
  opacity: 0.85;
}

.enable-btn:disabled {
  opacity: 0.5;
  cursor: wait;
}

.enable-message {
  margin-top: 6px;
  font-size: 10px;
  line-height: 1.4;
}

.enable-message.success {
  color: var(--color-accent-emerald, #34d399);
}

.enable-message.error {
  color: var(--color-accent-rose, #f43f5e);
}

.state-line.error {
  color: var(--color-accent-rose, #f43f5e);
}

.overview {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  font-size: 10px;
  color: var(--color-surface-500, #64748b);
  border-bottom: 1px solid var(--color-surface-800, #1e293b);
}

.overview-item {
  color: var(--color-surface-400, #94a3b8);
}

.overview-sep {
  color: var(--color-surface-700, #334155);
}

.refresh-btn {
  margin-left: auto;
  background: transparent;
  border: none;
  color: var(--color-surface-500, #64748b);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 4px;
}

.refresh-btn:hover:not(:disabled) {
  color: var(--color-surface-200, #e2e8f0);
}

.refresh-btn:disabled {
  opacity: 0.4;
  cursor: wait;
}

.change-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.change-item {
  border-radius: 4px;
}

.change-item:hover {
  background: rgba(255, 255, 255, 0.02);
}

.change-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 6px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  font-size: 11px;
  color: var(--color-surface-300, #cbd5e1);
}

.change-head:hover {
  background: rgba(255, 255, 255, 0.04);
}

.caret {
  flex-shrink: 0;
  font-size: 9px;
  color: var(--color-surface-500, #64748b);
}

.change-id {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--color-accent-cyan, #22d3ee);
  flex-shrink: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mini-progress {
  flex: 1;
  max-width: 60px;
  height: 3px;
  background: var(--color-surface-800, #1e293b);
  border-radius: 9999px;
  overflow: hidden;
}

.mini-fill {
  height: 100%;
  background: var(--color-accent-emerald, #34d399);
  transition: width 0.2s ease;
}

.mini-progress-text {
  font-family: var(--font-mono, monospace);
  font-size: 9px;
  color: var(--color-surface-500, #64748b);
}

.validation-mark {
  flex-shrink: 0;
  font-size: 11px;
}

.validation-mark.is-passed {
  color: var(--color-accent-emerald, #34d399);
}

.validation-mark.is-failed {
  color: var(--color-accent-rose, #f43f5e);
}

.change-detail-wrap {
  padding: 6px 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.validating-hint {
  font-size: 10px;
  color: var(--color-surface-500, #64748b);
  font-style: italic;
}
</style>
