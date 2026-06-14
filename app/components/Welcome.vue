<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useProject } from "../composables/useProject";
import { useBackend } from "../composables/useBackend";
import type { BackendKind } from "../backends/types";

const { t } = useI18n();
const router = useRouter();
const project = useProject();
const backend = useBackend();

const showProjectDialog = ref(false);
const manualPath = ref("");
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

function newSession() {
  router.push({ name: "chat" });
}

async function pickFolder() {
  // Try Electron native dialog first (returns absolute path)
  const nativeResult = await project.openDirectoryNative();
  if (nativeResult) {
    router.push({ name: "chat" });
    return;
  }
  // Try File System Access API (Chrome/Edge)
  if ("showDirectoryPicker" in window) {
    try {
      const handle = await window.showDirectoryPicker?.({ mode: "read" });
      if (!handle) throw new Error("No directory selected");
      await project.openDirectoryHandle(handle);
      router.push({ name: "chat" });
      return;
    } catch {
      // User cancelled or not allowed
    }
  }
  // Fallback: show manual input dialog
  showProjectDialog.value = true;
}

function submitManualPath() {
  const path = manualPath.value.trim();
  if (!path) return;
  project.openDirectoryPath(path);
  showProjectDialog.value = false;
  router.push({ name: "chat" });
}
</script>

<template>
  <div class="flex-1 flex items-center justify-center">
    <div class="text-center max-w-md">
      <!-- Logo -->
      <div class="mb-6 flex justify-center">
        <div
          class="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-cyan via-accent-indigo to-accent-emerald opacity-80"
        />
      </div>

      <!-- Title -->
      <h1 class="text-xl font-bold text-surface-200 mb-2">
        {{ t("welcome.title") }}
      </h1>
      <p class="text-sm text-surface-500 mb-8">
        {{ t("welcome.subtitle") }}
      </p>

      <!-- Description -->
      <p class="text-xs text-surface-600 mb-6">
        {{ t("welcome.getStarted") }}
      </p>

      <!-- Agent selector -->
      <div class="mb-6">
        <p class="text-xs text-surface-500 mb-2">{{ t("welcome.chooseAgent") }}</p>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="opt in agentOptions"
            :key="opt.kind"
            type="button"
            :disabled="switching"
            :class="[
              'px-3 py-2 rounded-lg border text-left transition-colors disabled:opacity-50',
              backend.activeBackendKind.value === opt.kind
                ? 'border-accent-cyan/60 bg-accent-cyan/10'
                : 'border-surface-700 bg-surface-800/50 hover:border-surface-600',
            ]"
            @click="chooseAgent(opt.kind)"
          >
            <div class="flex items-start gap-2">
              <span
                class="flex-shrink-0 mt-0.5"
                :class="opt.kind === 'zero' ? 'text-accent-indigo' : 'text-accent-cyan'"
              >
                <!-- OpenCode: official logo path (background stripped, fill=currentColor) -->
                <svg
                  v-if="opt.kind === 'opencode'"
                  width="20"
                  height="20"
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
                  width="20"
                  height="20"
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
              <div class="min-w-0">
                <div class="text-sm font-medium text-surface-100">{{ t(opt.labelKey) }}</div>
              </div>
            </div>
          </button>
        </div>

        <!-- Agent switch error -->
        <p v-if="backend.errorMessage.value" class="text-xs text-accent-rose mt-2 text-left">
          {{ backend.errorMessage.value }}
        </p>
      </div>

      <!-- Actions -->
      <div class="flex gap-3 justify-center">
        <button
          class="px-4 py-2 text-sm font-medium rounded-lg bg-accent-cyan/15 text-accent-cyan hover:bg-accent-cyan/25 transition-colors"
          @click="newSession"
        >
          {{ t("welcome.newSession") }}
        </button>
        <button
          class="px-4 py-2 text-sm font-medium rounded-lg bg-surface-800 text-surface-300 hover:bg-surface-700 transition-colors"
          @click="pickFolder"
        >
          {{ t("welcome.openProject") }}
        </button>
      </div>

      <!-- Manual path dialog -->
      <Teleport to="body">
        <div
          v-if="showProjectDialog"
          class="fixed inset-0 z-[10000] flex items-center justify-center"
        >
          <div class="absolute inset-0 bg-black/60" @click="showProjectDialog = false" />
          <div
            class="relative w-full max-w-sm bg-surface-900 border border-surface-700 rounded-xl shadow-2xl p-5"
          >
            <h3 class="text-sm font-semibold text-surface-200 mb-3">Open Project</h3>
            <input
              v-model="manualPath"
              type="text"
              placeholder="/path/to/project"
              class="w-full px-3 py-2 text-sm rounded-lg bg-surface-800 border border-surface-700 text-surface-100 placeholder:text-surface-600 focus:outline-none focus:border-accent-cyan/50 mb-3"
              @keydown.enter="submitManualPath"
            />
            <div class="flex justify-end gap-2">
              <button
                class="px-3 py-1.5 text-xs rounded-lg bg-surface-800 text-surface-400 hover:text-surface-200 transition-colors"
                @click="showProjectDialog = false"
              >
                Cancel
              </button>
              <button
                class="px-3 py-1.5 text-xs rounded-lg bg-accent-cyan/15 text-accent-cyan hover:bg-accent-cyan/25 transition-colors disabled:opacity-30"
                :disabled="!manualPath.trim()"
                @click="submitManualPath"
              >
                Open
              </button>
            </div>
          </div>
        </div>
      </Teleport>
    </div>
  </div>
</template>
