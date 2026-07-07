<script setup lang="ts">
// Single shared modal that renders a markdown artifact (currently tasks.md)
// from an OpenSpec change. State is driven by useArtifactModal so any caller
// can pop it without event plumbing.
import { computed, watch, onMounted, onUnmounted } from "vue";
import { useArtifactModal } from "../composables/useArtifactModal";
import { renderMarkdown } from "../composables/useMarkdown";

const { state, close, resolveContent } = useArtifactModal();

const artifact = computed(() => (state.open ? resolveContent() : null));
const html = computed(() => (artifact.value?.raw ? renderMarkdown(artifact.value.raw) : ""));

function onKey(e: KeyboardEvent) {
  if (!state.open) return;
  if (e.key === "Escape") close();
}

watch(
  () => state.open,
  (o) => {
    if (o) window.addEventListener("keydown", onKey);
    else window.removeEventListener("keydown", onKey);
  },
);

onMounted(() => {
  if (state.open) window.addEventListener("keydown", onKey);
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="mam-fade">
      <div v-if="state.open && artifact" class="mam-layer">
        <div class="mam-backdrop" @click="close" />
        <section class="mam-dialog" role="dialog" aria-modal="true" :aria-label="artifact.title">
          <header class="mam-header">
            <div class="mam-title-group">
              <span class="mam-kicker">OpenSpec</span>
              <span class="mam-title">{{ artifact.title }}</span>
              <span class="mam-path" :title="artifact.path">{{ artifact.path }}</span>
            </div>
            <button type="button" class="mam-close" :title="'Close'" @click="close">
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
          <div class="mam-body">
            <div v-if="html" class="md-content" v-html="html" />
            <div v-else class="mam-empty">No content</div>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mam-layer {
  position: fixed;
  inset: 0;
  z-index: 9700;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.mam-backdrop {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--color-surface-950, #020617) 72%, transparent);
  backdrop-filter: blur(8px);
}

.mam-dialog {
  position: relative;
  width: min(720px, 100%);
  max-height: min(80vh, 720px);
  display: flex;
  flex-direction: column;
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
    0 0 0 1px color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 10%, transparent);
  overflow: hidden;
}

.mam-fade-enter-active,
.mam-fade-leave-active {
  transition: opacity 0.16s ease;
}
.mam-fade-enter-from,
.mam-fade-leave-to {
  opacity: 0;
}

.mam-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 80%, transparent);
}

.mam-title-group {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.mam-kicker {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--color-accent-cyan, #22d3ee);
}

.mam-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-surface-100, #f1f5f9);
  font-family: var(--font-mono, monospace);
}

.mam-path {
  font-size: 11px;
  color: var(--color-surface-500, #64748b);
  font-family: var(--font-mono, monospace);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.mam-close {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 50%, transparent);
  background: transparent;
  color: var(--color-surface-400, #94a3b8);
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.mam-close:hover {
  background: color-mix(in srgb, var(--color-surface-700, #334155) 30%, transparent);
  color: var(--color-surface-200, #e2e8f0);
}

.mam-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px 20px;
}

.mam-empty {
  color: var(--color-surface-600, #475569);
  font-size: 12px;
  text-align: center;
  padding: 24px 0;
}
</style>
