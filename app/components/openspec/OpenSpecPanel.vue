<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useOpenSpec } from "../../composables/useOpenSpec";
import { useProject } from "../../composables/useProject";
import OpenSpecChangeDetail from "./OpenSpecChangeDetail.vue";

const { t } = useI18n();
const { state, refresh, toggleTask, runValidate, init } = useOpenSpec();
const project = useProject();

const props = withDefaults(
  defineProps<{
    variant?: "compact" | "dialog";
  }>(),
  {
    variant: "compact",
  },
);

const expanded = ref<Record<string, boolean>>({});
const archivedExpanded = ref<Record<string, boolean>>({});
const capsExpanded = ref<Record<string, boolean>>({});
type ChangeTab = "active" | "archived" | "capabilities";
const activeTab = ref<ChangeTab>("active");
const toggling = ref<Record<string, boolean>>({});
const validating = ref<Record<string, boolean>>({});
const enabling = ref(false);
const enableMessage = ref<{ kind: "success" | "error"; text: string } | null>(null);

function toggleExpand(id: string) {
  expanded.value[id] = !expanded.value[id];
}

function toggleArchivedExpand(id: string) {
  archivedExpanded.value[id] = !archivedExpanded.value[id];
}

function toggleCapExpand(name: string) {
  capsExpanded.value[name] = !capsExpanded.value[name];
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
    // Clear enable message after 3 seconds.
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
  <div class="openspec-panel" :class="`is-${props.variant}`">
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
      <!-- Top-level tabs: Active / Archived / Capabilities + refresh icon (dialog only) -->
      <div v-if="props.variant === 'dialog'" class="change-tabs">
        <button
          class="change-tab"
          :class="{ active: activeTab === 'active' }"
          @click="activeTab = 'active'"
        >
          {{ t("openspec.tabActive") }}
          <span class="change-tab-badge">{{ state.activeChanges.length }}</span>
        </button>
        <button
          class="change-tab"
          :class="{ active: activeTab === 'archived' }"
          @click="activeTab = 'archived'"
        >
          {{ t("openspec.tabArchived") }}
          <span class="change-tab-badge">{{ state.archivedChanges.length }}</span>
        </button>
        <button
          class="change-tab"
          :class="{ active: activeTab === 'capabilities' }"
          @click="activeTab = 'capabilities'"
        >
          {{ t("openspec.tabCapabilities") }}
          <span class="change-tab-badge">{{ state.capabilities.length }}</span>
        </button>
        <button
          class="refresh-btn"
          :disabled="state.loading"
          :title="t('openspec.refresh')"
          @click="refresh()"
        >
          <svg
            class="refresh-icon"
            :class="{ 'is-spinning': state.loading }"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            <polyline points="21 4 21 9 16 9" />
          </svg>
        </button>
      </div>

      <!-- Compact variant: keep the slim overview with refresh icon -->
      <div v-else class="overview">
        <span class="overview-item">
          {{ state.activeChanges.length }} active ·
          {{ t("openspec.capabilitiesCount", { count: state.capabilities.length }) }}
        </span>
        <button
          class="refresh-btn"
          :disabled="state.loading"
          :title="t('openspec.refresh')"
          @click="refresh()"
        >
          <svg
            class="refresh-icon"
            :class="{ 'is-spinning': state.loading }"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            <polyline points="21 4 21 9 16 9" />
          </svg>
        </button>
      </div>

      <!-- Active changes list -->
      <div v-if="activeTab === 'active'">
        <div v-if="!state.activeChanges.length" class="state-line empty">
          {{ t("openspec.noActiveChanges") }}
        </div>
        <div v-else class="change-list">
          <div v-for="change in state.activeChanges" :key="change.id" class="change-item">
            <!-- Collapse header -->
            <button class="change-head" @click="toggleExpand(change.id)">
              <span class="caret">{{ expanded[change.id] ? "v" : ">" }}</span>
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
                {{ state.validation[change.id].passed ? "OK" : "ERR" }}
              </span>
            </button>

            <!-- Expanded detail -->
            <div
              v-if="props.variant === 'dialog' || expanded[change.id]"
              class="change-detail-wrap"
            >
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
      </div>

      <!-- Archived changes list (dialog only, read-only) -->
      <div v-if="activeTab === 'archived'">
        <div v-if="!state.archivedChanges.length" class="state-line empty">
          {{ t("openspec.noArchivedChanges") }}
        </div>
        <div v-else class="change-list">
          <div v-for="change in state.archivedChanges" :key="change.id" class="change-item">
            <button class="change-head" @click="toggleArchivedExpand(change.id)">
              <span class="caret">{{ archivedExpanded[change.id] ? "v" : ">" }}</span>
              <span class="change-id">{{ change.id }}</span>
              <span v-if="change.archivedAt" class="archived-date">
                {{ t("openspec.archivedOn", { date: change.archivedAt }) }}
              </span>
              <div
                class="mini-progress"
                :title="`${change.taskStats.completed}/${change.taskStats.total}`"
              >
                <div class="mini-fill" :style="{ width: `${progressPct(change.taskStats)}%` }" />
              </div>
              <span class="mini-progress-text"
                >{{ change.taskStats.completed }}/{{ change.taskStats.total }}</span
              >
              <span class="archived-mark">{{ t("openspec.archivedBadge") }}</span>
            </button>

            <div v-if="archivedExpanded[change.id]" class="change-detail-wrap">
              <OpenSpecChangeDetail :change="change" read-only />
            </div>
          </div>
        </div>
      </div>

      <!-- Capabilities list (dialog only, expandable per-cap) -->
      <div v-if="activeTab === 'capabilities'">
        <div v-if="!state.capabilities.length" class="state-line empty">
          {{ t("openspec.noCapabilities") }}
        </div>
        <div v-else class="cap-accordion">
          <div
            v-for="cap in state.capabilities"
            :key="cap.name"
            class="cap-item"
            :class="{ 'is-missing': !cap.hasSpec }"
          >
            <button class="cap-head" @click="toggleCapExpand(cap.name)">
              <span class="caret">{{ capsExpanded[cap.name] ? "v" : ">" }}</span>
              <span class="cap-name">{{ cap.name }}</span>
              <span v-if="!cap.hasSpec" class="cap-missing-mark">
                {{ t("openspec.capabilityNoSpec") }}
              </span>
              <span v-else-if="cap.requirements?.length" class="cap-req-count">
                {{ t("openspec.capabilityRequirements", { count: cap.requirements.length }) }}
              </span>
            </button>

            <div v-if="capsExpanded[cap.name]" class="cap-body">
              <template v-if="!cap.hasSpec">
                <div class="cap-empty">{{ t("openspec.capabilityNoSpec") }}</div>
              </template>
              <template v-else>
                <div v-if="cap.purpose" class="cap-purpose">
                  <div class="cap-section-label">{{ t("openspec.capabilityPurpose") }}</div>
                  <div class="cap-purpose-text">{{ cap.purpose }}</div>
                </div>
                <div v-if="cap.requirements?.length" class="cap-requirements">
                  <div v-for="req in cap.requirements" :key="req.name" class="cap-req">
                    <div class="cap-req-header">
                      <span class="cap-req-name">{{ req.name }}</span>
                      <span
                        v-if="req.level"
                        class="cap-req-level"
                        :class="`is-${req.level.toLowerCase()}`"
                      >
                        {{ req.level }}
                      </span>
                    </div>
                    <div v-if="req.text" class="cap-req-text">{{ req.text }}</div>
                    <div v-if="req.scenarios?.length" class="cap-scenarios">
                      <div v-for="(sc, sIdx) in req.scenarios" :key="sIdx" class="cap-scenario">
                        <div class="cap-scenario-name">{{ sc.name }}</div>
                        <div
                          v-for="(step, stepIdx) in sc.steps"
                          :key="stepIdx"
                          class="cap-scenario-step"
                        >
                          <span class="cap-step-keyword">{{ step.keyword }}</span>
                          <span class="cap-step-text">{{ step.text }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-if="!cap.purpose && !cap.requirements?.length" class="cap-empty">
                  {{ t("openspec.capabilityNoSpec") }}
                </div>
              </template>
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

.openspec-panel.is-dialog {
  gap: 10px;
  padding: 16px 18px;
  font-size: 13px;
  background: var(--color-surface-950, #020617);
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

.is-dialog .overview {
  flex: 0 0 auto;
  gap: 8px;
  padding: 0 0 12px;
  font-size: 12px;
}

/* ── Capabilities accordion ─────────────────────────────────────────── */
.cap-accordion {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-bottom: 24px;
}

.cap-item {
  border: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 75%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--color-surface-900, #0f172a) 74%, transparent);
  overflow: hidden;
}

.cap-item.is-missing {
  opacity: 0.7;
}

.cap-head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 12px 14px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
  color: var(--color-surface-200, #e2e8f0);
}

.cap-head:hover {
  background: color-mix(in srgb, var(--color-surface-800, #1e293b) 22%, transparent);
}

.cap-head .caret {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--color-surface-500, #64748b);
}

.cap-name {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono, monospace);
  font-size: 13px;
  color: var(--color-accent-cyan, #22d3ee);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cap-req-count {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--color-surface-400, #94a3b8);
  font-family: var(--font-mono, monospace);
}

.cap-missing-mark {
  flex-shrink: 0;
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 3px;
  color: var(--color-accent-amber, #fbbf24);
  background: color-mix(in srgb, var(--color-accent-amber, #fbbf24) 12%, transparent);
  font-weight: 600;
  letter-spacing: 0.04em;
}

.cap-body {
  padding: 0 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-top: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 70%, transparent);
}

.cap-section-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-surface-400, #94a3b8);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 4px;
}

.cap-purpose-text {
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-surface-200, #e2e8f0);
  white-space: pre-wrap;
}

.cap-requirements {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cap-req {
  padding-left: 10px;
  border-left: 2px solid color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 30%, transparent);
}

.cap-req-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.cap-req-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-surface-100, #f1f5f9);
}

.cap-req-level {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 3px;
  letter-spacing: 0.05em;
  background: var(--color-surface-700, #334155);
  color: var(--color-surface-200, #e2e8f0);
}

.cap-req-level.is-must {
  background: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 22%, transparent);
  color: var(--color-accent-rose, #f43f5e);
}

.cap-req-level.is-shall {
  background: color-mix(in srgb, var(--color-accent-amber, #fbbf24) 22%, transparent);
  color: var(--color-accent-amber, #fbbf24);
}

.cap-req-level.is-should {
  background: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 22%, transparent);
  color: var(--color-accent-cyan, #22d3ee);
}

.cap-req-text {
  font-size: 12px;
  line-height: 1.55;
  color: var(--color-surface-300, #cbd5e1);
  white-space: pre-wrap;
}

.cap-scenarios {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cap-scenario {
  padding: 6px 8px;
  background: color-mix(in srgb, var(--color-surface-950, #020617) 50%, transparent);
  border-radius: 4px;
  border-left: 2px solid var(--color-surface-700, #334155);
}

.cap-scenario-name {
  font-size: 11px;
  font-style: italic;
  color: var(--color-surface-400, #94a3b8);
  margin-bottom: 3px;
}

.cap-scenario-step {
  font-size: 12px;
  color: var(--color-surface-300, #cbd5e1);
  display: flex;
  gap: 6px;
  line-height: 1.5;
}

.cap-step-keyword {
  flex-shrink: 0;
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  font-weight: 700;
  padding: 0 4px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--color-accent-amber, #fbbf24) 18%, transparent);
  color: var(--color-accent-amber, #fbbf24);
  height: 16px;
  line-height: 16px;
  align-self: center;
}

.cap-step-text {
  flex: 1;
  min-width: 0;
}

.cap-empty {
  font-size: 12px;
  color: var(--color-surface-500, #64748b);
  font-style: italic;
  padding: 4px 0;
}

.change-tabs {
  flex: 0 0 auto;
  display: flex;
  gap: 4px;
  padding: 0 0 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 70%, transparent);
  margin-bottom: 6px;
}

.change-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-surface-500, #64748b);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  transition:
    color 0.15s,
    background 0.15s,
    border-color 0.15s;
}

.change-tab:hover {
  color: var(--color-surface-200, #e2e8f0);
}

.change-tab.active {
  color: var(--color-accent-cyan, #22d3ee);
  background: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 10%, transparent);
  border-color: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 38%, transparent);
}

.change-tab-badge {
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-surface-700, #334155) 70%, transparent);
  color: var(--color-surface-300, #cbd5e1);
  font-size: 10px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}

.change-tab.active .change-tab-badge {
  background: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 22%, transparent);
  color: var(--color-accent-cyan, #22d3ee);
}

.archived-date {
  font-size: 10px;
  color: var(--color-surface-500, #64748b);
  font-family: var(--font-mono, monospace);
}

.is-dialog .archived-date {
  font-size: 11px;
}

.archived-mark {
  flex-shrink: 0;
  margin-left: auto;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--color-surface-400, #94a3b8);
  background: color-mix(in srgb, var(--color-surface-700, #334155) 50%, transparent);
}

.is-dialog .archived-mark {
  font-size: 10px;
  padding: 2px 8px;
}

.overview-item {
  color: var(--color-surface-400, #94a3b8);
}

.overview-sep {
  color: var(--color-surface-700, #334155);
}

.refresh-btn {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--color-surface-500, #64748b);
  cursor: pointer;
  transition:
    color 0.15s,
    background 0.15s,
    border-color 0.15s;
}

.refresh-btn:hover:not(:disabled) {
  color: var(--color-surface-100, #f1f5f9);
  background: color-mix(in srgb, var(--color-surface-800, #1e293b) 50%, transparent);
  border-color: color-mix(in srgb, var(--color-surface-700, #334155) 50%, transparent);
}

.refresh-icon {
  width: 15px;
  height: 15px;
}

.refresh-icon.is-spinning {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
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

.is-dialog .change-list {
  gap: 14px;
  padding-bottom: 24px;
}

.change-item {
  border-radius: 4px;
}

.is-dialog .change-item {
  border: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 75%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--color-surface-900, #0f172a) 74%, transparent);
}

.change-item:hover {
  background: rgba(255, 255, 255, 0.02);
}

.is-dialog .change-item:hover {
  background: color-mix(in srgb, var(--color-surface-900, #0f172a) 82%, transparent);
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

.is-dialog .change-head {
  cursor: default;
  gap: 10px;
  padding: 12px 14px;
  font-size: 13px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 70%, transparent);
}

.change-head:hover {
  background: rgba(255, 255, 255, 0.04);
}

.is-dialog .change-head:hover {
  background: transparent;
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

.is-dialog .change-id {
  font-size: 13px;
}

.mini-progress {
  flex: 1;
  max-width: 60px;
  height: 3px;
  background: var(--color-surface-800, #1e293b);
  border-radius: 9999px;
  overflow: hidden;
}

.is-dialog .mini-progress {
  max-width: 180px;
  height: 5px;
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

.is-dialog .mini-progress-text {
  font-size: 11px;
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

.is-dialog .change-detail-wrap {
  padding: 14px;
  gap: 12px;
}

.is-dialog :deep(.detail) {
  gap: 12px;
  font-size: 13px;
}

.is-dialog :deep(.tabs) {
  gap: 6px;
  padding-bottom: 8px;
}

.is-dialog :deep(.tab) {
  font-size: 13px;
  padding: 6px 10px;
}

.is-dialog :deep(.tab-badge),
.is-dialog :deep(.progress-text),
.is-dialog :deep(.validation-time) {
  font-size: 11px;
}

.is-dialog :deep(.validate-btn) {
  font-size: 12px;
  padding: 5px 12px;
}

.is-dialog :deep(.md-content) {
  max-height: none;
  font-size: 13px;
  line-height: 1.65;
  padding-right: 8px;
}

.is-dialog :deep(.tab-content) {
  gap: 10px;
}

.is-dialog :deep(.group-title),
.is-dialog :deep(.cap-title) {
  font-size: 12px;
}

.is-dialog :deep(.task-row) {
  padding: 5px 0;
  font-size: 13px;
}

.is-dialog :deep(.task-label) {
  gap: 8px;
}

.is-dialog :deep(.task-meta) {
  margin-left: 28px;
  margin-top: 4px;
  gap: 3px;
}

.is-dialog :deep(.meta-line),
.is-dialog :deep(.scenario-name),
.is-dialog :deep(.scenario-step),
.is-dialog :deep(.validation-hint),
.is-dialog :deep(.raw-toggle) {
  font-size: 12px;
}

.is-dialog :deep(.validation) {
  font-size: 13px;
}

.is-dialog :deep(.issue) {
  grid-template-columns: auto minmax(160px, auto) 1fr auto;
  gap: 10px;
  padding: 6px 8px;
  border-left-width: 1px;
  font-size: 12px;
}

.is-dialog :deep(.raw-output) {
  max-height: 320px;
  padding: 8px 10px;
  font-size: 12px;
}

.validating-hint {
  font-size: 10px;
  color: var(--color-surface-500, #64748b);
  font-style: italic;
}
</style>
