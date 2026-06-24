<script setup lang="ts">
// ---------------------------------------------------------------------------
// UpdateToast — lightweight feedback for non-blocking update outcomes
// ---------------------------------------------------------------------------
// Only handles brief status hints after manual checks:
//   - up-to-date: "you're on the latest version" (auto-dismiss)
//   - error:      "check failed: <reason>" (manual-only; auto errors are
//                 suppressed server-side)
// Available / progress / downloaded states are handled by UpdateDialog.
// ---------------------------------------------------------------------------

import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useUpdate } from "../composables/useUpdate";
import { isElectron } from "../utils/electronBridge";

const { t } = useI18n();
const inElectron = isElectron();
const { state } = useUpdate();

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
  if (manualUpToDate.value) return true;
  if (state.value.status === "error" && state.value.error) return true;
  return false;
});
</script>

<template>
  <Teleport to="body">
    <Transition name="update-toast">
      <div v-if="visible" class="update-toast">
        <!-- Up-to-date (manual) -->
        <template v-if="manualUpToDate">
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
  min-width: 240px;
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
