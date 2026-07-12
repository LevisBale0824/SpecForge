<script setup lang="ts">
// Generic themed confirmation dialog. Replaces window.confirm with the
// project's surface-900/violet aesthetic. Promise-based: caller awaits
// <ConfirmDialog>.confirm(...) and gets boolean back.
import { ref, shallowRef, watch } from "vue";

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

const open = ref(false);
const opts = ref<Required<ConfirmOptions>>({
  title: "",
  message: "",
  confirmText: "确认",
  cancelText: "取消",
  danger: false,
});
const resolveRef = shallowRef<((v: boolean) => void) | null>(null);

function confirm(options: ConfirmOptions): Promise<boolean> {
  opts.value = {
    title: options.title,
    message: options.message ?? "",
    confirmText: options.confirmText ?? "确认",
    cancelText: options.cancelText ?? "取消",
    danger: options.danger ?? false,
  };
  open.value = true;
  return new Promise<boolean>((resolve) => {
    resolveRef.value = resolve;
  });
}

function close(value: boolean) {
  open.value = false;
  resolveRef.value?.(value);
  resolveRef.value = null;
}

function onKey(e: KeyboardEvent) {
  if (!open.value) return;
  if (e.key === "Escape") close(false);
  else if (e.key === "Enter") close(true);
}

watch(open, (o) => {
  if (o) window.addEventListener("keydown", onKey);
  else window.removeEventListener("keydown", onKey);
});

defineExpose({ confirm });
</script>

<template>
  <Teleport to="body">
    <Transition name="cd-fade">
      <div v-if="open" class="cd-layer">
        <div class="cd-backdrop" @click="close(false)" />
        <section class="cd-dialog" :class="{ danger: opts.danger }" role="dialog" aria-modal="true">
          <header class="cd-header">
            <div class="cd-icon" :class="{ danger: opts.danger }">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M12 9v4M12 17h.01" />
                <path
                  d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                />
              </svg>
            </div>
            <h2 class="cd-title">{{ opts.title }}</h2>
          </header>
          <div v-if="opts.message" class="cd-body">{{ opts.message }}</div>
          <footer class="cd-footer">
            <button type="button" class="cd-btn cd-cancel" @click="close(false)">
              {{ opts.cancelText }}
            </button>
            <button
              type="button"
              class="cd-btn cd-confirm"
              :class="{ danger: opts.danger }"
              @click="close(true)"
            >
              {{ opts.confirmText }}
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cd-layer {
  position: fixed;
  inset: 0;
  z-index: 9800;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  overflow: auto;
}

.cd-backdrop {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--color-surface-950, #020617) 72%, transparent);
  backdrop-filter: blur(8px);
}

.cd-dialog {
  position: relative;
  width: min(440px, 100%);
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 22px 22px 18px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 50%, transparent);
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--color-surface-800, #1e293b) 80%, transparent),
      color-mix(in srgb, var(--color-surface-900, #0f172a) 94%, transparent)
    ),
    var(--color-surface-900, #0f172a);
  box-shadow:
    0 30px 80px -20px rgba(0, 0, 0, 0.7),
    0 0 0 1px color-mix(in srgb, var(--color-accent-violet, #a78bfa) 8%, transparent);
}

.cd-dialog.danger {
  box-shadow:
    0 30px 80px -20px rgba(0, 0, 0, 0.7),
    0 0 0 1px color-mix(in srgb, var(--color-accent-rose, #f43f5e) 18%, transparent);
}

.cd-fade-enter-active,
.cd-fade-leave-active {
  transition: opacity 0.16s ease;
}
.cd-fade-enter-from,
.cd-fade-leave-to {
  opacity: 0;
}

.cd-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.cd-icon {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 50%, transparent);
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 12%, transparent);
  color: var(--color-accent-violet, #a78bfa);
}

.cd-icon.danger {
  border-color: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 36%, transparent);
  background: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 14%, transparent);
  color: var(--color-accent-rose, #f43f5e);
}

.cd-icon svg {
  width: 18px;
  height: 18px;
}

.cd-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--color-surface-100, #f1f5f9);
  line-height: 1.3;
}

.cd-body {
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-surface-400, #94a3b8);
  white-space: pre-wrap;
  padding: 0 4px;
}

.cd-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 4px;
}

.cd-btn {
  min-width: 76px;
  padding: 7px 14px;
  font-size: 12px;
  font-weight: 700;
  font-family: inherit;
  border-radius: 9px;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

.cd-cancel {
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 50%, transparent);
  background: transparent;
  color: var(--color-surface-300, #cbd5e1);
}

.cd-cancel:hover {
  background: color-mix(in srgb, var(--color-surface-700, #334155) 30%, transparent);
}

.cd-confirm {
  border: 1px solid color-mix(in srgb, var(--color-accent-violet, #a78bfa) 40%, transparent);
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 18%, transparent);
  color: var(--color-accent-violet, #a78bfa);
}

.cd-confirm:hover {
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 28%, transparent);
}

.cd-confirm.danger {
  border-color: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 40%, transparent);
  background: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 18%, transparent);
  color: var(--color-accent-rose, #f43f5e);
}

.cd-confirm.danger:hover {
  background: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 30%, transparent);
}
</style>
