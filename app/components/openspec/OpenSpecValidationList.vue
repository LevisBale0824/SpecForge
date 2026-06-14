<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import type { OpenSpecValidationResult } from "../../types/openspec";

const { t } = useI18n();

defineProps<{
  result?: OpenSpecValidationResult;
  cliUnavailableHint?: boolean;
}>();

const showRaw = ref(false);
</script>

<template>
  <div class="validation">
    <div v-if="!result" class="validation-empty">
      {{ t("openspec.validateNone") }}
    </div>
    <template v-else>
      <div class="validation-status" :class="result.passed ? 'is-passed' : 'is-failed'">
        <span class="dot" />
        <span>{{
          result.passed ? t("openspec.validatePassed") : t("openspec.validateFailed")
        }}</span>
        <span v-if="result.ranAt" class="validation-time">
          {{ new Date(result.ranAt).toLocaleTimeString() }}
        </span>
      </div>

      <div v-if="!result.cliAvailable" class="validation-hint">
        {{ t("openspec.cliUnavailable") }}
      </div>

      <ul v-if="result.issues.length" class="issue-list">
        <li
          v-for="(issue, idx) in result.issues"
          :key="idx"
          class="issue"
          :class="`is-${issue.severity}`"
        >
          <span class="severity-tag">{{ issue.severity }}</span>
          <span v-if="issue.file" class="issue-file">
            {{ issue.file }}<template v-if="issue.line">:{{ issue.line }}</template>
          </span>
          <span class="issue-msg">{{ issue.message }}</span>
          <span v-if="issue.rule" class="issue-rule">[{{ issue.rule }}]</span>
        </li>
      </ul>

      <button v-if="result.rawOutput" class="raw-toggle" @click="showRaw = !showRaw">
        {{ t("openspec.rawOutput") }} {{ showRaw ? "▾" : "▸" }}
      </button>
      <pre v-if="showRaw && result.rawOutput" class="raw-output">{{ result.rawOutput }}</pre>
    </template>
  </div>
</template>

<style scoped>
.validation {
  font-size: 11px;
}

.validation-empty {
  color: var(--color-surface-500, #64748b);
  padding: 4px 0;
}

.validation-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  color: var(--color-surface-300, #cbd5e1);
}

.validation-status.is-passed {
  color: var(--color-accent-emerald, #34d399);
}

.validation-status.is-failed {
  color: var(--color-accent-rose, #f43f5e);
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background-color: currentColor;
}

.validation-time {
  margin-left: auto;
  font-size: 10px;
  color: var(--color-surface-600, #475569);
}

.validation-hint {
  font-size: 10px;
  color: var(--color-surface-500, #64748b);
  padding: 2px 0;
}

.issue-list {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.issue {
  display: grid;
  grid-template-columns: auto auto 1fr auto;
  gap: 6px;
  align-items: baseline;
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  padding: 2px 4px;
  border-left: 2px solid currentColor;
}

.issue.is-error {
  color: var(--color-accent-rose, #f43f5e);
}

.issue.is-warning {
  color: var(--color-accent-amber, #fbbf24);
}

.severity-tag {
  font-weight: 600;
  text-transform: uppercase;
}

.issue-file {
  color: var(--color-surface-400, #94a3b8);
}

.issue-msg {
  color: var(--color-surface-200, #e2e8f0);
  word-break: break-word;
}

.issue-rule {
  color: var(--color-surface-500, #64748b);
}

.raw-toggle {
  margin-top: 6px;
  background: transparent;
  border: none;
  color: var(--color-surface-500, #64748b);
  font-size: 10px;
  cursor: pointer;
  padding: 0;
}

.raw-toggle:hover {
  color: var(--color-surface-300, #cbd5e1);
}

.raw-output {
  margin-top: 4px;
  padding: 4px 6px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  color: var(--color-surface-400, #94a3b8);
  max-height: 160px;
  overflow: auto;
  white-space: pre-wrap;
}
</style>
