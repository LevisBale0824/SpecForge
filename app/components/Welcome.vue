<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useBackend } from "../composables/useBackend";
import type { BackendKind } from "../backends/types";

const { t, tm } = useI18n();
const backend = useBackend();

const switching = ref(false);

const agentOptions: Array<{ kind: BackendKind; labelKey: string }> = [
  { kind: "opencode", labelKey: "welcome.agent.opencode" },
  { kind: "zero", labelKey: "welcome.agent.zero" },
];

const capabilityKeys = ["chat", "workflow", "project", "agent"] as const;

async function chooseAgent(kind: BackendKind) {
  if (kind === backend.activeBackendKind.value || switching.value) return;
  switching.value = true;
  try {
    await backend.switchBackend(kind);
  } finally {
    switching.value = false;
  }
}
</script>

<template>
  <div class="wc-page">
    <div class="wc-card">
      <!-- Brand -->
      <div class="wc-brand">
        <svg
          class="wc-logo"
          viewBox="0 0 256 256"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="SpecForge"
          role="img"
        >
          <rect class="sf-bg" width="256" height="256" rx="48" />
          <path
            class="sf-bracket"
            d="M96 72 L28 128 L96 184"
            stroke-width="8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            class="sf-bracket"
            d="M160 72 L228 128 L160 184"
            stroke-width="8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <circle class="sf-cyan" cx="108" cy="172" r="8" />
          <circle class="sf-indigo" cx="124" cy="148" r="9" />
          <circle class="sf-emerald" cx="140" cy="124" r="10" />
          <circle class="sf-amber" cx="156" cy="100" r="11" />
        </svg>
        <div class="wc-kicker">
          <span class="wc-kick-a">Spec</span><span class="wc-kick-b">Forge</span>
        </div>
        <h1 class="wc-title">{{ t("welcome.intro.title") }}</h1>
        <p class="wc-sub">{{ t("welcome.intro.sub") }}</p>
      </div>

      <!-- Capabilities -->
      <div class="wc-caps">
        <div v-for="k in capabilityKeys" :key="k" class="wc-cap">
          <div class="wc-cap-title">{{ t(`welcome.intro.capabilities.${k}.title`) }}</div>
          <div class="wc-cap-desc">{{ t(`welcome.intro.capabilities.${k}.desc`) }}</div>
        </div>
      </div>

      <!-- Agent picker -->
      <div class="wc-agents">
        <span class="wc-agents-label">{{ t("welcome.chooseAgent") }}</span>
        <div class="wc-agents-row">
          <button
            v-for="opt in agentOptions"
            :key="opt.kind"
            type="button"
            :disabled="switching"
            :class="['wc-agent', { active: backend.activeBackendKind.value === opt.kind }]"
            @click="chooseAgent(opt.kind)"
          >
            <span class="wc-agent-icon" :class="opt.kind === 'zero' ? 'zero' : 'opencode'">
              <svg
                v-if="opt.kind === 'opencode'"
                width="18"
                height="18"
                viewBox="0 0 256 256"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M160.5 79.4H95.5V176.6H160.5V79.4ZM193 209H63V47H193V209Z" />
              </svg>
              <svg
                v-else-if="opt.kind === 'zero'"
                width="18"
                height="18"
                viewBox="0 0 256 256"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fill-rule="evenodd"
                  clip-rule="evenodd"
                  d="M58.9375 53.625C57.5285 53.625 56.1773 54.1847 55.181 55.181C54.1847 56.1773 53.625 57.5285 53.625 58.9375V175.813H43V58.9375C43 54.7106 44.6791 50.6568 47.668 47.668C50.6568 44.6791 54.7106 43 58.9375 43H201.275C208.375 43 211.929 51.5832 206.91 56.6035L119.243 144.269H143.938V133.313H154.563V146.927C154.563 149.04 153.723 151.067 152.229 152.561C150.734 154.056 148.707 154.895 146.594 154.895H108.618L90.3574 173.156H173.156V106.75H183.781V173.156C183.781 175.974 182.662 178.677 180.669 180.669C178.677 182.662 175.974 183.781 173.156 183.781H79.7324L61.1386 202.375H197.063C198.471 202.375 199.823 201.815 200.819 200.819C201.815 199.823 202.375 198.471 202.375 197.063V80.1875H213V197.063C213 201.289 211.321 205.343 208.332 208.332C205.343 211.321 201.289 213 197.063 213H54.7247C47.6254 213 44.0714 204.417 49.0899 199.396L136.424 112.063H112.063V122.688H101.438V109.406C101.438 107.293 102.277 105.266 103.771 103.771C105.266 102.277 107.293 101.438 109.406 101.438H147.049L165.643 82.8438H82.8438V149.25H72.2188V82.8438C72.2188 80.0258 73.3382 77.3233 75.3307 75.3307C77.3233 73.3382 80.0258 72.2188 82.8438 72.2188H176.268L194.861 53.625H58.9375Z"
                />
              </svg>
            </span>
            <span class="wc-agent-name">{{ t(opt.labelKey) }}</span>
          </button>
        </div>
        <p v-if="backend.errorMessage.value" class="wc-agent-error">
          {{ backend.errorMessage.value }}
        </p>
      </div>

      <!-- Steps -->
      <div class="wc-steps">
        <div class="wc-steps-title">{{ t("welcome.intro.steps.title") }}</div>
        <ol class="wc-steps-list">
          <li v-for="(item, i) in tm('welcome.intro.steps.items') as string[]" :key="i">
            <span class="wc-step-num">{{ i + 1 }}</span>
            <span class="wc-step-text">{{ item }}</span>
          </li>
        </ol>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wc-page {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 40px;
  overflow-y: auto;
}
.wc-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
  text-align: center;
  max-width: 640px;
  width: 100%;
}

/* Brand */
.wc-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.wc-logo {
  width: 72px;
  height: 72px;
  border-radius: 16px;
  margin-bottom: 4px;
}
.wc-kicker {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.wc-kick-a {
  color: var(--color-accent-cyan, #22d3ee);
}
.wc-kick-b {
  color: var(--color-accent-indigo, #6366f1);
}
.wc-title {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--color-surface-100, #f1f5f9);
}
.wc-sub {
  margin: 0;
  max-width: 520px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-surface-400, #94a3b8);
}

/* Capabilities */
.wc-caps {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  width: 100%;
}
.wc-cap {
  padding: 12px 12px 14px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 40%, transparent);
  background: color-mix(in srgb, var(--color-surface-900, #0f172a) 60%, transparent);
  text-align: left;
}
.wc-cap-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-surface-100, #f1f5f9);
  margin-bottom: 4px;
}
.wc-cap-desc {
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-surface-500, #64748b);
}

/* Steps */
.wc-steps {
  width: 100%;
  text-align: left;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 30%, transparent);
  background: color-mix(in srgb, var(--color-surface-950, #020617) 50%, transparent);
}
.wc-steps-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-surface-500, #64748b);
  margin-bottom: 10px;
}
.wc-steps-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wc-steps-list li {
  display: flex;
  align-items: center;
  gap: 10px;
}
.wc-step-num {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 16%, transparent);
  color: var(--color-accent-cyan, #22d3ee);
  font-size: 11px;
  font-weight: 800;
  font-family: var(--font-mono, monospace);
}
.wc-step-text {
  font-size: 12px;
  color: var(--color-surface-300, #cbd5e1);
  line-height: 1.5;
}

/* Agent picker */
.wc-agents {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.wc-agents-label {
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--color-surface-500, #64748b);
}
.wc-agents-row {
  display: flex;
  gap: 8px;
}
.wc-agent {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-width: 116px;
  padding: 6px 12px 6px 8px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 50%, transparent);
  background: color-mix(in srgb, var(--color-surface-900, #0f172a) 60%, transparent);
  color: var(--color-surface-300, #cbd5e1);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease;
}
.wc-agent:hover {
  border-color: color-mix(in srgb, var(--color-surface-600, #475569) 70%, transparent);
  color: var(--color-surface-100, #f1f5f9);
}
.wc-agent.active {
  border-color: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 60%, transparent);
  background: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 12%, transparent);
  color: var(--color-accent-cyan, #22d3ee);
}
.wc-agent:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.wc-agent-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
}
.wc-agent-icon.opencode {
  color: var(--color-accent-cyan, #22d3ee);
}
.wc-agent-icon.zero {
  color: var(--color-accent-indigo, #6366f1);
}
.wc-agent-name {
  font-size: 12px;
}
.wc-agent-error {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--color-accent-rose, #f43f5e);
}

/* SpecForge brand logo — adaptive dark/light via prefers-color-scheme.
   Mirrors public/specforge-icon.svg so the inlined markup stays in sync. */
.sf-bg {
  fill: #0b0e14;
}
.sf-bracket {
  fill: none;
  stroke: #f1f5f9;
}
.sf-cyan {
  fill: #22d3ee;
}
.sf-indigo {
  fill: #6366f1;
}
.sf-emerald {
  fill: #10b981;
}
.sf-amber {
  fill: #f59e0b;
}
@media (prefers-color-scheme: light) {
  .sf-bg {
    fill: #f4f2ed;
  }
  .sf-bracket {
    stroke: #1e293b;
  }
  .sf-cyan {
    fill: #0891b2;
  }
  .sf-indigo {
    fill: #4f4645;
  }
  .sf-emerald {
    fill: #059669;
  }
  .sf-amber {
    fill: #d97706;
  }
}
</style>
