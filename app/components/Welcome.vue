<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useBackend } from "../composables/useBackend";
import type { BackendKind } from "../backends/types";

const { t } = useI18n();
const backend = useBackend();

const switching = ref(false);

const agentOptions: Array<{ kind: BackendKind; labelKey: string }> = [
  { kind: "opencode", labelKey: "welcome.agent.opencode" },
  { kind: "zero", labelKey: "welcome.agent.zero" },
];

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
  <div class="flex-1 flex items-center justify-center">
    <div class="text-center max-w-lg">
      <!-- Logo -->
      <div class="mb-4 flex justify-center">
        <svg
          class="w-28 h-28 rounded-2xl"
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
      </div>

      <!-- Title -->
      <h1 class="text-2xl font-bold text-surface-200 mb-1">
        {{ t("welcome.title") }}
      </h1>
      <p class="text-sm text-surface-500 mb-4">
        {{ t("welcome.subtitle") }}
      </p>

      <!-- Description -->
      <p class="text-sm text-surface-600 mb-4">
        {{ t("welcome.getStarted") }}
      </p>

      <!-- Agent selector -->
      <div class="mb-4">
        <p class="text-sm text-surface-500 mb-2">{{ t("welcome.chooseAgent") }}</p>
        <div class="grid grid-cols-2 gap-2.5">
          <button
            v-for="opt in agentOptions"
            :key="opt.kind"
            type="button"
            :disabled="switching"
            :class="[
              'px-4 py-4 rounded-lg border text-center transition-colors disabled:opacity-50',
              backend.activeBackendKind.value === opt.kind
                ? 'border-accent-cyan/60 bg-accent-cyan/10'
                : 'border-surface-700 bg-surface-800/50 hover:border-surface-600',
            ]"
            @click="chooseAgent(opt.kind)"
          >
            <div class="flex flex-col items-center gap-2">
              <span
                class="flex-shrink-0"
                :class="opt.kind === 'zero' ? 'text-accent-indigo' : 'text-accent-cyan'"
              >
                <!-- OpenCode: official logo path (background stripped, fill=currentColor) -->
                <svg
                  v-if="opt.kind === 'opencode'"
                  width="36"
                  height="36"
                  viewBox="0 0 256 256"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M160.5 79.4H95.5V176.6H160.5V79.4ZM193 209H63V47H193V209Z" />
                </svg>
                <!-- Zero: Zed editor logo (Zero has no official icon, Zed is
                     aesthetic-shorthand for a code-focused editor) -->
                <svg
                  v-else-if="opt.kind === 'zero'"
                  width="36"
                  height="36"
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
              <div class="min-w-0 text-center">
                <div class="text-base font-medium text-surface-100">{{ t(opt.labelKey) }}</div>
              </div>
            </div>
          </button>
        </div>

        <!-- Agent switch error -->
        <p v-if="backend.errorMessage.value" class="text-xs text-accent-rose mt-2 text-left">
          {{ backend.errorMessage.value }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
    fill: #4f46e5;
  }
  .sf-emerald {
    fill: #059669;
  }
  .sf-amber {
    fill: #d97706;
  }
}
</style>
