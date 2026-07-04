<script setup lang="ts">
// ---------------------------------------------------------------------------
// HelpModal — quick-start carousel covering SpecForge's core features.
// ---------------------------------------------------------------------------
// Opens from the topbar Help button. Cycles through 8 cards (welcome, sessions,
// agent, model, OpenSpec, files, appearance, update) with auto-advance,
// hover-pause, prev/next buttons, dot indicators, and keyboard arrows.
//
// Layout mirrors UpdateDialog.vue (Teleport + Transition + backdrop sibling),
// with an inner <Transition mode="out-in"> for cross-fading between cards.
// ---------------------------------------------------------------------------

import { nextTick, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Icon } from "@iconify/vue";

const { t } = useI18n();

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [boolean] }>();

interface Slide {
  icon: string;
  titleKey: string;
  bodyKey: string;
  bullets?: string[];
}

const slides: Slide[] = [
  { icon: "lucide:sparkles", titleKey: "help.intro.title", bodyKey: "help.intro.body" },
  { icon: "lucide:boxes", titleKey: "help.agent.title", bodyKey: "help.agent.body" },
  { icon: "lucide:folder-open", titleKey: "help.project.title", bodyKey: "help.project.body" },
  {
    icon: "lucide:messages-square",
    titleKey: "help.sessions.title",
    bodyKey: "help.sessions.body",
    bullets: ["help.sessions.bullets[0]", "help.sessions.bullets[1]", "help.sessions.bullets[2]"],
  },
  { icon: "lucide:sliders-horizontal", titleKey: "help.model.title", bodyKey: "help.model.body" },
  {
    icon: "lucide:workflow",
    titleKey: "help.openspec.title",
    bodyKey: "help.openspec.body",
    bullets: ["help.openspec.bullets[0]", "help.openspec.bullets[1]", "help.openspec.bullets[2]"],
  },
  { icon: "lucide:folder-tree", titleKey: "help.files.title", bodyKey: "help.files.body" },
  { icon: "lucide:palette", titleKey: "help.appearance.title", bodyKey: "help.appearance.body" },
  { icon: "lucide:cloud-download", titleKey: "help.update.title", bodyKey: "help.update.body" },
];

const current = ref(0);
const dialogEl = ref<HTMLElement | null>(null);

const AUTO_ADVANCE_MS = 5500;
let timer: ReturnType<typeof setInterval> | null = null;
let paused = false;

function clearTimer() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function startTimer() {
  clearTimer();
  timer = setInterval(() => {
    if (paused) return;
    if (current.value >= slides.length - 1) {
      // Last slide: stop auto-advancing so the user can finish reading.
      clearTimer();
      return;
    }
    current.value += 1;
  }, AUTO_ADVANCE_MS);
}

function pauseAuto() {
  paused = true;
}

function resumeAuto() {
  paused = false;
}

function goTo(idx: number) {
  current.value = idx;
  // Restart timer so a manual navigation doesn't immediately get overridden.
  startTimer();
}

function next() {
  if (current.value < slides.length - 1) {
    current.value += 1;
    startTimer();
  }
}

function prev() {
  if (current.value > 0) {
    current.value -= 1;
    startTimer();
  }
}

function close() {
  emit("update:modelValue", false);
}

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      current.value = 0;
      paused = false;
      startTimer();
      // Focus the dialog so ESC / arrow keys work without an extra click.
      await nextTick();
      dialogEl.value?.focus();
    } else {
      clearTimer();
    }
  },
);

onUnmounted(() => clearTimer());
</script>

<template>
  <Teleport to="body">
    <Transition name="help-modal">
      <div v-if="modelValue" class="hm-overlay">
        <div class="hm-backdrop" @click="close" />
        <div
          ref="dialogEl"
          class="hm-dialog"
          role="dialog"
          aria-modal="true"
          :aria-label="t('help.ariaLabel')"
          tabindex="-1"
          @keydown.esc.prevent="close"
          @keydown.arrow-left.prevent="prev"
          @keydown.arrow-right.prevent="next"
        >
          <header class="hm-header">
            <h3>{{ t("help.title") }}</h3>
            <div class="hm-counter">{{ current + 1 }} / {{ slides.length }}</div>
            <button class="hm-close" :aria-label="t('common.close')" @click="close">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </header>

          <div class="hm-stage" @mouseenter="pauseAuto" @mouseleave="resumeAuto">
            <Transition name="hm-card" mode="out-in">
              <div :key="current" class="hm-card">
                <div class="hm-card-icon">
                  <Icon :icon="slides[current].icon" width="28" />
                </div>
                <h4>{{ t(slides[current].titleKey) }}</h4>
                <p>{{ t(slides[current].bodyKey) }}</p>
                <ul v-if="slides[current].bullets" class="hm-bullets">
                  <li v-for="(b, i) in slides[current].bullets" :key="i">{{ t(b) }}</li>
                </ul>
              </div>
            </Transition>
          </div>

          <footer class="hm-footer">
            <button class="hm-nav" :disabled="current === 0" @click="prev">
              {{ t("help.prev") }}
            </button>
            <div class="hm-dots">
              <button
                v-for="(s, i) in slides"
                :key="i"
                class="hm-dot"
                :class="{ 'is-active': i === current }"
                :aria-label="t('help.dotLabel', { n: i + 1 })"
                @click="goTo(i)"
              />
            </div>
            <button
              class="hm-nav hm-nav-primary"
              @click="current === slides.length - 1 ? close() : next()"
            >
              {{ current === slides.length - 1 ? t("help.done") : t("help.next") }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.hm-overlay {
  position: fixed;
  inset: 0;
  z-index: 10002;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hm-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
}

.hm-dialog {
  position: relative;
  width: min(560px, calc(100vw - 2rem));
  max-height: calc(100vh - 4rem);
  display: flex;
  flex-direction: column;
  background: var(--color-surface-900, #18181b);
  border: 1px solid var(--color-surface-700, #334155);
  border-radius: 14px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
  color: var(--color-surface-100, #f1f5f9);
  outline: none;
  overflow: hidden;
}

.hm-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--color-surface-800, #1f2937);
}

.hm-header h3 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-surface-100, #f1f5f9);
}

.hm-counter {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--color-surface-400, #94a3b8);
  font-variant-numeric: tabular-nums;
}

.hm-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--color-surface-800, #1f2937);
  color: var(--color-surface-400, #94a3b8);
  border: none;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.hm-close:hover {
  color: var(--color-surface-100, #f1f5f9);
  background: var(--color-surface-700, #334155);
}

.hm-stage {
  flex: 1 1 auto;
  /* Fixed height (not min-height) so the dialog doesn't resize when cards
     with/without bullets swap — that resizing was the visual jitter.
     320px fits the tallest card (OpenSpec, 4 bullets) with headroom.
     align-items: flex-start anchors the card to the top so the icon stays
     pinned in the top-left corner across slides instead of "drifting"
     vertically as card heights vary. */
  height: 320px;
  display: flex;
  align-items: flex-start;
  justify-content: stretch;
  padding: 1.5rem;
  overflow: auto;
}

.hm-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  width: 100%;
}

.hm-card-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  margin-bottom: 0.85rem;
  background: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 14%, transparent);
  color: var(--color-accent-cyan, #22d3ee);
}

.hm-card h4 {
  margin: 0 0 0.5rem;
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--color-surface-100, #f1f5f9);
}

.hm-card p {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--color-surface-300, #cbd5e1);
}

.hm-bullets {
  list-style: none;
  margin: 0.85rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  text-align: left;
}

.hm-bullets li {
  position: relative;
  padding-left: 1.1rem;
  font-size: 0.825rem;
  color: var(--color-surface-300, #cbd5e1);
}

.hm-bullets li::before {
  content: "";
  position: absolute;
  left: 0.2rem;
  top: 0.55rem;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-accent-cyan, #22d3ee);
}

.hm-footer {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.85rem 1.25rem;
  border-top: 1px solid var(--color-surface-800, #1f2937);
}

.hm-nav {
  padding: 0.45rem 0.9rem;
  font-size: 0.8rem;
  border-radius: 7px;
  background: var(--color-surface-800, #1f2937);
  color: var(--color-surface-200, #e2e8f0);
  border: 1px solid var(--color-surface-700, #334155);
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    opacity 0.15s ease;
}

.hm-nav:hover:not(:disabled) {
  background: var(--color-surface-700, #334155);
}

.hm-nav:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.hm-nav-primary {
  background: var(--color-accent-cyan, #22d3ee);
  color: var(--color-surface-950, #09090b);
  border-color: transparent;
  font-weight: 600;
}

.hm-nav-primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 85%, white);
}

.hm-dots {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0 auto;
}

.hm-dot {
  width: 8px;
  height: 8px;
  padding: 0;
  border-radius: 999px;
  background: var(--color-surface-600, #475569);
  border: none;
  cursor: pointer;
  transition:
    width 0.25s ease,
    background 0.2s ease;
}

.hm-dot.is-active {
  width: 24px;
  background: var(--color-accent-cyan, #22d3ee);
}

/* Modal enter/leave — mirrors UpdateDialog.vue. */
.help-modal-enter-active,
.help-modal-leave-active {
  transition: opacity 0.2s ease;
}

.help-modal-enter-active .hm-dialog,
.help-modal-leave-active .hm-dialog {
  transition:
    transform 0.25s ease,
    opacity 0.25s ease;
}

.help-modal-enter-from,
.help-modal-leave-to {
  opacity: 0;
}

.help-modal-enter-from .hm-dialog,
.help-modal-leave-to .hm-dialog {
  transform: translateY(12px) scale(0.98);
  opacity: 0;
}

/* Card cross-fade with a subtle horizontal slide. */
.hm-card-enter-active,
.hm-card-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
}

.hm-card-enter-from {
  opacity: 0;
  transform: translateX(14px);
}

.hm-card-leave-to {
  opacity: 0;
  transform: translateX(-14px);
}

@media (prefers-reduced-motion: reduce) {
  .help-modal-enter-active,
  .help-modal-leave-active,
  .help-modal-enter-active .hm-dialog,
  .help-modal-leave-active .hm-dialog,
  .hm-card-enter-active,
  .hm-card-leave-active,
  .hm-dot {
    transition: none;
  }
}
</style>
