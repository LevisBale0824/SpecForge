<script setup lang="ts">
// ---------------------------------------------------------------------------
// UpdateToast — global, self-contained update notification
// ---------------------------------------------------------------------------
// Renders a single toast in the bottom-right that reflects the current
// update state: available → prompt to view, progress → progress bar,
// downloaded → "restart and install", error → brief failure message.
// Manual "up-to-date" feedback also flows through here via the manual flag.
// ---------------------------------------------------------------------------

import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useUpdate } from "../composables/useUpdate";
import { isElectron } from "../utils/electronBridge";

const { t } = useI18n();
const inElectron = isElectron();
const { state, installUpdate } = useUpdate();

// Visibility rules:
// - "available" / "progress" / "downloaded": visible
// - "error": only when triggered manually (auto errors are server-side silent)
// - manual "up-to-date": visible briefly via local flag
const manualUpToDate = ref(false);
let upToDateTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => state.value.status,
  (status) => {
    if (status === "up-to-date") {
      manualUpToDate.value = true;
      if (upToDateTimer) clearTimeout(upToDateTimer);
      upToDateTimer = setTimeout(() => {
        manualUpToDate.value = false;
      }, 3500);
    }
  },
);

const visible = computed(() => {
  if (!inElectron) return false;
  const s = state.value.status;
  if (s === "available" || s === "progress" || s === "downloaded") return true;
  if (s === "error" && state.value.error) return true;
  if (manualUpToDate.value) return true;
  return false;
});

const installing = ref(false);
async function restart() {
  if (installing.value) return;
  installing.value = true;
  try {
    await installUpdate();
  } finally {
    installing.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="update-toast">
      <div v-if="visible" class="update-toast">
        <!-- Available -->
        <template v-if="state.status === 'available'">
          <div class="ut-icon ut-icon-info">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 4v12m0 4h.01M4 12a8 8 0 1116 0 8 8 0 01-16 0z"
              />
            </svg>
          </div>
          <div class="ut-body">
            <div class="ut-title">{{ t("update.available") }}</div>
            <div class="ut-sub">v{{ state.version }} · {{ t("update.downloading") }}</div>
            <div class="ut-progress-track">
              <div class="ut-progress-bar ut-progress-indeterminate" />
            </div>
          </div>
        </template>

        <!-- Progress -->
        <template v-else-if="state.status === 'progress'">
          <div class="ut-icon ut-icon-info">
            <svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-width="2" d="M4 12a8 8 0 018-8" />
            </svg>
          </div>
          <div class="ut-body">
            <div class="ut-title">{{ t("update.downloading") }}</div>
            <div class="ut-sub">{{ state.percent }}%</div>
            <div class="ut-progress-track">
              <div class="ut-progress-bar" :style="{ width: state.percent + '%' }" />
            </div>
          </div>
        </template>

        <!-- Downloaded -->
        <template v-else-if="state.status === 'downloaded'">
          <div class="ut-icon ut-icon-success">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2.5"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <div class="ut-body">
            <div class="ut-title">{{ t("update.ready") }}</div>
            <div class="ut-sub">v{{ state.version }}</div>
          </div>
          <button class="ut-btn ut-btn-primary" :disabled="installing" @click="restart">
            {{ t("update.install") }}
          </button>
        </template>

        <!-- Error (manual only) -->
        <template v-else-if="state.status === 'error'">
          <div class="ut-icon ut-icon-error">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              />
            </svg>
          </div>
          <div class="ut-body">
            <div class="ut-title">{{ t("update.failed") }}</div>
            <div class="ut-sub ut-sub-error">{{ state.error }}</div>
          </div>
        </template>

        <!-- Up-to-date (manual) -->
        <template v-else-if="manualUpToDate">
          <div class="ut-icon ut-icon-success">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2.5"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <div class="ut-body">
            <div class="ut-title">{{ t("update.upToDate") }}</div>
          </div>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.update-toast {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: 10001;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 280px;
  max-width: 360px;
  padding: 0.85rem 1rem;
  background: var(--color-surface-900, #18181b);
  border: 1px solid var(--color-surface-700, #334155);
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  color: var(--color-surface-100, #f4f4f5);
}

.ut-icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
}

.ut-icon-info {
  background: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 18%, transparent);
  color: var(--color-accent-cyan, #22d3ee);
}

.ut-icon-success {
  background: color-mix(in srgb, var(--color-accent-emerald, #10b981) 18%, transparent);
  color: var(--color-accent-emerald, #10b981);
}

.ut-icon-error {
  background: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 18%, transparent);
  color: var(--color-accent-rose, #f43f5e);
}

.ut-body {
  flex: 1 1 auto;
  min-width: 0;
}

.ut-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-surface-100, #f4f4f5);
}

.ut-sub {
  margin-top: 2px;
  font-size: 11px;
  color: var(--color-surface-400, #94a3b8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ut-sub-error {
  color: var(--color-accent-rose, #f43f5e);
}

.ut-progress-track {
  position: relative;
  height: 3px;
  margin-top: 0.5rem;
  background: var(--color-surface-800, #27272a);
  border-radius: 2px;
  overflow: hidden;
}

.ut-progress-bar {
  height: 100%;
  background: var(--color-accent-cyan, #22d3ee);
  border-radius: 2px;
  transition: width 0.2s ease;
}

.ut-progress-indeterminate {
  width: 40% !important;
  animation: ut-indeterminate 1.4s ease-in-out infinite;
}

@keyframes ut-indeterminate {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(280%);
  }
}

.ut-btn {
  flex: 0 0 auto;
  padding: 0.4rem 0.85rem;
  font-size: 12px;
  font-weight: 600;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    opacity 0.15s ease;
}

.ut-btn-primary {
  background: var(--color-accent-cyan, #22d3ee);
  color: var(--color-surface-950, #0f172a);
}

.ut-btn-primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 85%, white);
}

.ut-btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.update-toast-enter-active,
.update-toast-leave-active {
  transition:
    transform 0.25s ease,
    opacity 0.25s ease;
}

.update-toast-enter-from,
.update-toast-leave-to {
  transform: translateY(12px);
  opacity: 0;
}
</style>
