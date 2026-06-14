<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { OpenSpecChange, OpenSpecValidationResult } from "../../types/openspec";
import { renderMarkdown } from "../../composables/useMarkdown";
import OpenSpecTaskRow from "./OpenSpecTaskRow.vue";
import OpenSpecValidationList from "./OpenSpecValidationList.vue";

const { t } = useI18n();

const props = defineProps<{
  change: OpenSpecChange;
  validation?: OpenSpecValidationResult;
  cliUnavailable?: boolean;
  toggling?: boolean;
}>();

const emit = defineEmits<{
  "toggle-task": [taskId: string, completed: boolean];
  validate: [];
}>();

type Tab = "proposal" | "tasks" | "deltaSpecs";
const activeTab = ref<Tab>("proposal");

const proposalHtml = computed(() => {
  if (!props.change.proposal?.raw) return "";
  return renderMarkdown(props.change.proposal.raw);
});

const tasksByGroup = computed(() => {
  const groups = new Map<
    string,
    { title: string; index: number; tasks: typeof props.change.tasks }
  >();
  for (const task of props.change.tasks) {
    const key = `${task.groupIndex}:${task.groupTitle}`;
    if (!groups.has(key)) {
      groups.set(key, { title: task.groupTitle, index: task.groupIndex, tasks: [] });
    }
    groups.get(key)!.tasks.push(task);
  }
  return Array.from(groups.values()).sort((a, b) => a.index - b.index);
});

const deltaByCapability = computed(() => {
  const map = new Map<string, (typeof props.change.deltaSpecs)[number]["requirements"]>();
  for (const delta of props.change.deltaSpecs) {
    map.set(delta.capability, delta.requirements);
  }
  return Array.from(map.entries());
});

function opColor(op: string): string {
  switch (op) {
    case "added":
      return "var(--color-accent-emerald, #34d399)";
    case "modified":
      return "var(--color-accent-amber, #fbbf24)";
    case "removed":
      return "var(--color-accent-rose, #f43f5e)";
    case "renamed":
      return "var(--color-accent-cyan, #22d3ee)";
    default:
      return "var(--color-surface-500, #64748b)";
  }
}

function opLabel(op: string): string {
  switch (op) {
    case "added":
      return t("openspec.opAdded");
    case "modified":
      return t("openspec.opModified");
    case "removed":
      return t("openspec.opRemoved");
    case "renamed":
      return t("openspec.opRenamed");
    default:
      return op;
  }
}
</script>

<template>
  <div class="detail">
    <div class="tabs">
      <button
        class="tab"
        :class="{ active: activeTab === 'proposal' }"
        @click="activeTab = 'proposal'"
      >
        {{ t("openspec.proposal") }}
      </button>
      <button class="tab" :class="{ active: activeTab === 'tasks' }" @click="activeTab = 'tasks'">
        {{ t("openspec.tasks") }}
        <span class="tab-badge">{{ change.taskStats.completed }}/{{ change.taskStats.total }}</span>
      </button>
      <button
        v-if="change.deltaSpecs.length"
        class="tab"
        :class="{ active: activeTab === 'deltaSpecs' }"
        @click="activeTab = 'deltaSpecs'"
      >
        {{ t("openspec.deltaSpecs") }}
        <span class="tab-badge">{{ change.deltaSpecs.length }}</span>
      </button>

      <button class="validate-btn" :disabled="cliUnavailable || false" @click="emit('validate')">
        {{ t("openspec.validate") }}
      </button>
    </div>

    <!-- Proposal -->
    <div v-if="activeTab === 'proposal'" class="tab-content">
      <div v-if="proposalHtml" class="md-content" v-html="proposalHtml" />
      <div v-else class="empty">{{ t("openspec.proposal") }}: —</div>
    </div>

    <!-- Tasks -->
    <div v-else-if="activeTab === 'tasks'" class="tab-content">
      <div class="progress-row">
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: `${change.taskStats.progress * 100}%` }" />
        </div>
        <span class="progress-text">
          {{
            t("openspec.progress", {
              done: change.taskStats.completed,
              total: change.taskStats.total,
            })
          }}
        </span>
      </div>

      <div v-if="!change.tasks.length" class="empty">{{ t("openspec.noTasks") }}</div>
      <div v-else class="task-groups">
        <div v-for="group in tasksByGroup" :key="group.index" class="task-group">
          <div class="group-title">{{ group.index }}. {{ group.title }}</div>
          <ul class="task-list">
            <OpenSpecTaskRow
              v-for="task in group.tasks"
              :key="task.id"
              :task="task"
              :disabled="toggling"
              @toggle="(id, done) => emit('toggle-task', id, done)"
            />
          </ul>
        </div>
      </div>
    </div>

    <!-- Delta Specs -->
    <div v-else-if="activeTab === 'deltaSpecs'" class="tab-content">
      <div v-if="!change.deltaSpecs.length" class="empty">{{ t("openspec.noDeltaSpecs") }}</div>
      <div v-else class="delta-list">
        <div v-for="[cap, reqs] in deltaByCapability" :key="cap" class="delta-cap">
          <div class="cap-title">{{ cap }}</div>
          <ul class="delta-req-list">
            <li v-for="(req, idx) in reqs" :key="idx" class="delta-req">
              <span
                class="op-tag"
                :style="{ color: opColor(req.op), borderColor: opColor(req.op) }"
              >
                {{ opLabel(req.op) }}
              </span>
              <span class="req-name">{{ req.name }}</span>
              <span v-if="req.op === 'renamed' && req.fromName" class="req-from">
                ({{ t("openspec.renamedFrom") }}: {{ req.fromName }})
              </span>
              <div v-if="req.requirement?.scenarios?.length" class="req-scenarios">
                <div v-for="(sc, sIdx) in req.requirement.scenarios" :key="sIdx" class="scenario">
                  <div class="scenario-name">{{ sc.name }}</div>
                  <div v-for="(step, stepIdx) in sc.steps" :key="stepIdx" class="scenario-step">
                    <span class="step-keyword">{{ step.keyword }}</span>
                    <span class="step-text">{{ step.text }}</span>
                  </div>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Validation -->
    <OpenSpecValidationList :result="validation" :cli-unavailable-hint="cliUnavailable" />
  </div>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11px;
}

.tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  border-bottom: 1px solid var(--color-surface-800, #1e293b);
  padding-bottom: 4px;
}

.tab {
  background: transparent;
  border: none;
  color: var(--color-surface-400, #94a3b8);
  font-size: 11px;
  padding: 4px 8px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -5px;
}

.tab:hover {
  color: var(--color-surface-200, #e2e8f0);
}

.tab.active {
  color: var(--color-accent-cyan, #22d3ee);
  border-bottom-color: var(--color-accent-cyan, #22d3ee);
}

.tab-badge {
  margin-left: 4px;
  font-size: 9px;
  color: var(--color-surface-500, #64748b);
}

.validate-btn {
  margin-left: auto;
  background: var(--color-accent-cyan, #22d3ee);
  color: var(--color-surface-900, #0f172a);
  border: none;
  border-radius: 4px;
  padding: 3px 10px;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
}

.validate-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.tab-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.md-content {
  font-size: 11px;
  line-height: 1.5;
  max-height: 360px;
  overflow-y: auto;
  padding-right: 4px;
}

.empty {
  color: var(--color-surface-600, #475569);
  padding: 8px 0;
  text-align: center;
  font-size: 11px;
}

.progress-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.progress-track {
  flex: 1;
  height: 4px;
  background: var(--color-surface-800, #1e293b);
  border-radius: 9999px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--color-accent-emerald, #34d399);
  transition: width 0.2s ease;
}

.progress-text {
  font-size: 10px;
  color: var(--color-surface-400, #94a3b8);
  font-family: var(--font-mono, monospace);
}

.task-groups {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.task-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.group-title {
  font-size: 10px;
  font-weight: 600;
  color: var(--color-surface-300, #cbd5e1);
  margin-top: 4px;
}

.task-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.delta-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.delta-cap {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.cap-title {
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  color: var(--color-accent-cyan, #22d3ee);
  font-weight: 600;
}

.delta-req-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.delta-req {
  padding: 2px 0;
}

.op-tag {
  display: inline-block;
  font-size: 9px;
  font-weight: 600;
  padding: 1px 4px;
  border: 1px solid;
  border-radius: 3px;
  margin-right: 6px;
}

.req-name {
  font-weight: 500;
  color: var(--color-surface-200, #e2e8f0);
}

.req-from {
  font-size: 10px;
  color: var(--color-surface-500, #64748b);
  margin-left: 4px;
}

.req-scenarios {
  margin-left: 60px;
  margin-top: 4px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.scenario {
  padding-left: 6px;
  border-left: 1px solid var(--color-surface-800, #1e293b);
}

.scenario-name {
  font-size: 10px;
  color: var(--color-surface-400, #94a3b8);
  font-style: italic;
}

.scenario-step {
  font-size: 10px;
  color: var(--color-surface-400, #94a3b8);
  display: flex;
  gap: 4px;
}

.step-keyword {
  font-family: var(--font-mono, monospace);
  color: var(--color-accent-amber, #fbbf24);
  font-weight: 600;
}
</style>
