<script setup lang="ts">
import { watch } from "vue";
import type { WorkflowTier } from "../../types/workflow";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  pick: [tier: WorkflowTier];
  close: [];
}>();

interface TierCard {
  id: WorkflowTier;
  name: string;
  steps: string;
  fit: string;
  skip: string;
  dots: number;
  flow: string;
}

const TIERS: TierCard[] = [
  {
    id: "lean",
    name: "轻量",
    steps: "4 步",
    fit: "单文件小改",
    skip: "跳过 Explore · Plan · Review",
    dots: 4,
    flow: "Propose → Apply → Verify → Archive",
  },
  {
    id: "standard",
    name: "标准",
    steps: "5 步",
    fit: "模块内功能",
    skip: "跳过 Plan · Review",
    dots: 5,
    flow: "Explore → Propose → Apply → Verify → Archive",
  },
  {
    id: "thorough",
    name: "完整",
    steps: "7 步",
    fit: "跨模块 / 架构级",
    skip: "完整流程,不跳阶段",
    dots: 7,
    flow: "Explore → Propose → Plan → Apply → Verify → Review → Archive",
  },
];

// ESC 关闭
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && props.open) emit("close");
}
watch(
  () => props.open,
  (o) => {
    if (o) window.addEventListener("keydown", onKey);
    else window.removeEventListener("keydown", onKey);
  },
  { immediate: true },
);
</script>

<template>
  <Teleport to="body">
    <Transition name="tp-fade">
      <div v-if="props.open" class="tp-layer">
        <div class="tp-backdrop" @click="emit('close')" />
        <section class="tp-dialog" role="dialog" aria-modal="true" aria-label="选择探索档位">
          <header class="tp-header">
            <div>
              <span class="tp-kicker">新建探索</span>
              <h2 class="tp-title">这次改动有多大？</h2>
              <p class="tp-sub">不同档位走不同流程长度 — 选好后立即进入工作流</p>
            </div>
            <button type="button" class="tp-close" title="关闭" @click="emit('close')">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>
          <div class="tp-body">
            <button
              v-for="t in TIERS"
              :key="t.id"
              type="button"
              class="tp-card"
              :data-tier="t.id"
              @click="emit('pick', t.id)"
            >
              <div class="tp-row1">
                <span class="tp-name">{{ t.name }}</span>
                <span class="tp-steps">{{ t.steps }}</span>
                <span class="tp-fit">{{ t.fit }}</span>
              </div>
              <div class="tp-dots">
                <i v-for="n in t.dots" :key="n" class="tp-dot" />
              </div>
              <div class="tp-flow">{{ t.flow }}</div>
              <div class="tp-skip">{{ t.skip }}</div>
              <div class="tp-cta">选择 →</div>
            </button>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.tp-layer {
  position: fixed;
  inset: 0;
  z-index: 9500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
}

.tp-backdrop {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--color-surface-950, #020617) 72%, transparent);
  backdrop-filter: blur(8px);
}

.tp-dialog {
  position: relative;
  width: min(880px, 100%);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 16px;
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

.tp-fade-enter-active,
.tp-fade-leave-active {
  transition: opacity 0.18s ease;
}
.tp-fade-enter-from,
.tp-fade-leave-to {
  opacity: 0;
}

.tp-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 22px 24px 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 36%, transparent);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--color-accent-violet, #a78bfa) 8%, transparent),
    transparent
  );
}

.tp-kicker {
  display: inline-block;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-accent-violet, #a78bfa);
  margin-bottom: 4px;
}

.tp-title {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
  color: var(--color-surface-100, #f1f5f9);
  line-height: 1.2;
}

.tp-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--color-surface-500, #64748b);
}

.tp-close {
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 40%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-surface-950, #020617) 40%, transparent);
  color: var(--color-surface-400, #94a3b8);
  cursor: pointer;
}

.tp-close:hover {
  background: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 14%, transparent);
  color: var(--color-accent-rose, #f43f5e);
  border-color: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 30%, transparent);
}

.tp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 24px 24px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 14px;
}

.tp-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 18px 16px 14px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 40%, transparent);
  background: color-mix(in srgb, var(--color-surface-800, #1e293b) 50%, transparent);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  border-left-width: 3px;
  transition:
    transform 0.15s ease,
    border-color 0.15s ease,
    background 0.15s ease;
}

.tp-card:hover {
  transform: translateY(-2px);
  background: color-mix(in srgb, var(--color-surface-700, #334155) 36%, transparent);
}

.tp-card[data-tier="lean"] {
  border-left-color: var(--color-accent-emerald, #34d399);
}
.tp-card[data-tier="standard"] {
  border-left-color: var(--color-accent-violet, #a78bfa);
}
.tp-card[data-tier="thorough"] {
  border-left-color: var(--color-accent-amber, #fbbf24);
}

.tp-card[data-tier="lean"]:hover {
  border-left-color: var(--color-accent-emerald, #34d399);
  box-shadow: 0 8px 24px -10px
    color-mix(in srgb, var(--color-accent-emerald, #34d399) 50%, transparent);
}
.tp-card[data-tier="standard"]:hover {
  border-left-color: var(--color-accent-violet, #a78bfa);
  box-shadow: 0 8px 24px -10px
    color-mix(in srgb, var(--color-accent-violet, #a78bfa) 50%, transparent);
}
.tp-card[data-tier="thorough"]:hover {
  border-left-color: var(--color-accent-amber, #fbbf24);
  box-shadow: 0 8px 24px -10px
    color-mix(in srgb, var(--color-accent-amber, #fbbf24) 50%, transparent);
}

.tp-row1 {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.tp-name {
  font-size: 17px;
  font-weight: 800;
  color: var(--color-surface-100, #f1f5f9);
}

.tp-steps {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--color-surface-500, #64748b);
}

.tp-fit {
  margin-left: auto;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--color-surface-400, #94a3b8);
  padding: 2px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-surface-700, #334155) 36%, transparent);
}

.tp-dots {
  display: flex;
  gap: 6px;
}

.tp-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.tp-card[data-tier="lean"] .tp-dot {
  background: var(--color-accent-emerald, #34d399);
}
.tp-card[data-tier="standard"] .tp-dot {
  background: var(--color-accent-violet, #a78bfa);
}
.tp-card[data-tier="thorough"] .tp-dot {
  background: var(--color-accent-amber, #fbbf24);
}

.tp-flow {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--color-surface-400, #94a3b8);
  line-height: 1.5;
}

.tp-skip {
  font-size: 11px;
  color: var(--color-surface-500, #64748b);
  font-style: italic;
}

.tp-cta {
  margin-top: auto;
  padding-top: 6px;
  font-size: 12px;
  font-weight: 700;
  color: var(--color-surface-300, #cbd5e1);
  align-self: flex-start;
}

.tp-card[data-tier="lean"]:hover .tp-cta {
  color: var(--color-accent-emerald, #34d399);
}
.tp-card[data-tier="standard"]:hover .tp-cta {
  color: var(--color-accent-violet, #a78bfa);
}
.tp-card[data-tier="thorough"]:hover .tp-cta {
  color: var(--color-accent-amber, #fbbf24);
}
</style>
