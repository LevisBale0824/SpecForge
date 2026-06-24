<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { OpenSpecTask } from "../../types/openspec";

const { t } = useI18n();

defineProps<{
  task: OpenSpecTask;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  toggle: [taskId: string, completed: boolean];
}>();

function onToggle(e: Event) {
  const checked = (e.target as HTMLInputElement).checked;
  emit("toggle", (e.target as HTMLInputElement).dataset.taskId || "", checked);
}
</script>

<template>
  <li class="task-row" :class="{ 'is-completed': task.status === 'completed' }">
    <label class="task-label">
      <input
        type="checkbox"
        class="task-checkbox"
        :checked="task.status === 'completed'"
        :disabled="disabled"
        :data-task-id="task.id"
        @change="onToggle"
      />
      <span class="task-id">{{ task.id }}</span>
      <span class="task-title">{{ task.title }}</span>
    </label>

    <!-- 详情块(Requirement/Verification/...):仅勾选后展开 -->
    <div
      v-if="
        task.status === 'completed' &&
        (task.requirement || task.verification || task.estimate || task.dependsOn || task.result)
      "
      class="task-meta"
    >
      <div v-if="task.requirement" class="meta-line">
        <span class="meta-key">{{ t("openspec.taskRequirement") }}:</span>
        <code>{{ task.requirement }}</code>
      </div>
      <div v-if="task.verification" class="meta-line">
        <span class="meta-key">{{ t("openspec.taskVerification") }}:</span>
        <code>{{ task.verification }}</code>
      </div>
      <div v-if="typeof task.estimate === 'number'" class="meta-line">
        <span class="meta-key">{{ t("openspec.taskEstimate") }}:</span>
        <span>{{ task.estimate }} {{ t("openspec.minutes") }}</span>
      </div>
      <div v-if="task.dependsOn?.length" class="meta-line">
        <span class="meta-key">{{ t("openspec.taskDependsOn") }}:</span>
        <code>{{ task.dependsOn.join(", ") }}</code>
      </div>
      <div v-if="task.result" class="meta-line">
        <span class="meta-key">{{ t("openspec.taskResult") }}:</span>
        <span>{{ task.result }}</span>
      </div>
    </div>
  </li>
</template>

<style scoped>
.task-row {
  list-style: none;
  padding: 2px 0;
  font-size: 11px;
  line-height: 1.5;
}

.task-label {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  cursor: pointer;
  user-select: none;
}

.task-checkbox {
  flex-shrink: 0;
  margin-top: 2px;
  cursor: pointer;
}

.task-id {
  flex-shrink: 0;
  font-family: var(--font-mono, monospace);
  color: var(--color-surface-400, #94a3b8);
}

.task-title {
  flex: 1;
  min-width: 0;
  word-break: break-word;
  color: var(--color-surface-200, #e2e8f0);
}

.is-completed .task-title {
  text-decoration: line-through;
  color: var(--color-surface-500, #64748b);
}

.task-meta {
  margin-left: 20px;
  margin-top: 2px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.meta-line {
  font-size: 10px;
  color: var(--color-surface-500, #64748b);
}

.meta-key {
  color: var(--color-surface-400, #94a3b8);
  margin-right: 4px;
}

.meta-line code {
  font-family: var(--font-mono, monospace);
  color: var(--color-accent-cyan, #22d3ee);
}
</style>
