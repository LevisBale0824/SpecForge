<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useBackend } from "../composables/useBackend";
import { useTheme } from "../composables/useTheme";
import { StorageKeys, storageSet } from "../utils/storageKeys";
import { isElectron } from "../utils/electronBridge";
import { useUpdate } from "../composables/useUpdate";
import type { BackendKind } from "../backends/types";

const { t, locale } = useI18n();
const backend = useBackend();
const { currentThemeId, themes: themeList, applyTheme } = useTheme();

defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();

// ── Language ──────────────────────────────────────────────────────────

const languages = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "中文" },
];

const selectedLang = ref(locale.value);

function changeLocale(lang: string) {
  selectedLang.value = lang;
  locale.value = lang;
  storageSet(StorageKeys.ui.locale, lang);
}

// ── Agent selection ───────────────────────────────────────────────────

const agentOptions: Array<{ kind: BackendKind; labelKey: string }> = [
  { kind: "opencode", labelKey: "settings.opencode" },
  { kind: "zero", labelKey: "settings.zero" },
];

const switching = ref(false);

async function selectAgent(kind: BackendKind) {
  if (kind === backend.activeBackendKind.value || switching.value) return;
  switching.value = true;
  try {
    backend.disconnect();
    await backend.switchBackend(kind);
    urlInput.value = backend.baseUrl.value;
    authInput.value = backend.authHeader.value ?? "";
  } finally {
    switching.value = false;
  }
}

// ── Backend URL ───────────────────────────────────────────────────────

const urlInput = ref(backend.baseUrl.value);
const authInput = ref(backend.authHeader.value ?? "");

const urlPlaceholder = computed(() => {
  switch (backend.activeBackendKind.value) {
    case "zero":
      return "http://localhost:13286";
    case "cli-bridge":
      return "http://localhost:13285";
    default:
      return "http://localhost:13284";
  }
});

watch(
  () => backend.baseUrl.value,
  (v) => {
    urlInput.value = v;
  },
);

function applyUrl() {
  // Block writes during agent switch — switching is async and the URL input's
  // displayed value is mid-flight. Writing now would persist the *previous*
  // backend's URL into the *current* backend's storage key, which is exactly
  // how `opencode:baseUrl` ends up pointing at :13286 (zero's port).
  if (switching.value) return;
  backend.setBaseUrl(urlInput.value.trim());
}

function applyAuth() {
  if (switching.value) return;
  backend.setAuthHeader(authInput.value.trim() || undefined);
}

// ── Connection ────────────────────────────────────────────────────────

const restarting = ref(false);

async function restartAgent() {
  if (restarting.value) return;
  restarting.value = true;
  try {
    await backend.restartCurrentAgent();
  } finally {
    restarting.value = false;
  }
}

const statusColor: Record<string, string> = {
  disconnected: "bg-surface-600",
  connecting: "bg-accent-amber animate-pulse",
  bootstrapping: "bg-accent-amber animate-pulse",
  ready: "bg-accent-emerald",
  error: "bg-accent-rose",
};

const statusText: Record<string, string> = {
  disconnected: "status.disconnected",
  connecting: "status.connecting",
  bootstrapping: "status.connecting",
  ready: "status.connected",
  error: "status.error",
};

function toggleConnection() {
  if (backend.connectionState.value === "ready") {
    backend.disconnect();
  } else {
    backend.connect();
  }
}

function close() {
  emit("update:modelValue", false);
}

// ── Active tab ────────────────────────────────────────────────────────
type SettingsTab = "backend" | "appearance" | "about";
const activeTab = ref<SettingsTab>("backend");

// ── About / Update ───────────────────────────────────────────────────────
const inElectron = isElectron();
const update = useUpdate();
const checking = ref(false);

async function checkForUpdates() {
  if (checking.value) return;
  checking.value = true;
  try {
    await update.checkForUpdates();
  } finally {
    checking.value = false;
  }
}

// Local proxy input mirrors update.proxy with an editable buffer.
const proxyInput = ref(update.proxy.value);
async function applyProxy() {
  await update.setProxy(proxyInput.value);
}

// Update status line under the "check now" button.
const updateStatus = computed(() => {
  const s = update.state.value.status;
  if (s === "checking") return t("update.checking");
  if (s === "progress") return `${t("update.downloading")} · ${update.state.value.percent}%`;
  if (s === "downloaded") return `${t("update.ready")} · v${update.state.value.version}`;
  if (s === "available") return `${t("update.available")} · v${update.state.value.version}`;
  return "";
});
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="settings-overlay">
      <!-- Backdrop -->
      <div class="settings-backdrop" @click="close" />

      <!-- Panel -->
      <div class="settings-panel">
        <!-- Header -->
        <div class="settings-header">
          <h2 class="settings-title">{{ t("settings.title") }}</h2>
          <button class="settings-close" @click="close">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <!-- Tabs -->
        <div class="settings-tabs">
          <button
            type="button"
            class="settings-tab"
            :class="{ 'is-active': activeTab === 'backend' }"
            @click="activeTab = 'backend'"
          >
            {{ t("settings.tabBackend") }}
          </button>
          <button
            type="button"
            class="settings-tab"
            :class="{ 'is-active': activeTab === 'appearance' }"
            @click="activeTab = 'appearance'"
          >
            {{ t("settings.tabAppearance") }}
          </button>
          <button
            v-if="inElectron"
            type="button"
            class="settings-tab"
            :class="{ 'is-active': activeTab === 'about' }"
            @click="activeTab = 'about'"
          >
            {{ t("settings.tabAbout") }}
          </button>
        </div>

        <!-- Tab body -->
        <div class="settings-body">
          <!-- ── Backend tab ───────────────────────────────────────────── -->
          <template v-if="activeTab === 'backend'">
            <!-- Connection Status -->
            <div class="setting-section">
              <label class="setting-label">{{ t("settings.backend") }}</label>
              <div class="flex items-center gap-2">
                <span
                  class="w-2 h-2 rounded-full"
                  :class="statusColor[backend.connectionState.value] ?? 'bg-surface-600'"
                />
                <span
                  class="text-sm flex-1"
                  :class="
                    backend.connectionState.value === 'ready'
                      ? 'text-accent-emerald'
                      : 'text-surface-400'
                  "
                >
                  {{ t(statusText[backend.connectionState.value] ?? "status.disconnected") }}
                </span>
                <button
                  v-if="backend.isElectron"
                  type="button"
                  :disabled="restarting"
                  :title="t('settings.restartAgent')"
                  class="px-2 py-1 text-xs rounded bg-surface-800 text-surface-300 hover:bg-surface-700 hover:text-accent-cyan transition-colors disabled:opacity-40 disabled:cursor-wait flex items-center gap-1"
                  @click="restartAgent"
                >
                  <svg
                    class="w-3 h-3"
                    :class="restarting ? 'animate-spin' : ''"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2.5"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  <span>{{
                    restarting ? t("settings.restarting") : t("settings.restartAgent")
                  }}</span>
                </button>
              </div>
              <p v-if="backend.errorMessage.value" class="text-xs text-accent-rose mt-1.5">
                {{ backend.errorMessage.value }}
              </p>
            </div>

            <!-- Code Agent selector -->
            <div class="setting-section">
              <label class="setting-label">{{ t("settings.agent") }}</label>
              <div class="grid grid-cols-2 gap-2">
                <button
                  v-for="opt in agentOptions"
                  :key="opt.kind"
                  type="button"
                  :disabled="switching"
                  :class="[
                    'px-3 py-2 text-sm rounded-lg border transition-colors disabled:opacity-50',
                    backend.activeBackendKind.value === opt.kind
                      ? 'border-accent-cyan/60 bg-accent-cyan/15 text-accent-cyan'
                      : 'border-surface-700 bg-surface-800 text-surface-300 hover:border-surface-600',
                  ]"
                  @click="selectAgent(opt.kind)"
                >
                  {{ t(opt.labelKey) }}
                </button>
              </div>
              <p v-if="switching" class="text-[10px] text-surface-500 mt-1.5">
                {{ t("status.connecting") }}
              </p>
            </div>

            <!-- Server URL — hidden in Electron mode. The main process spawns
                 opencode/zero daemons on hardcoded ports (13284/13286), so the
                 URL is never user-configurable here. Letting users edit it only
                 opens a race where the wrong port gets persisted to the wrong
                 backend's storage key (the root cause of recurring 13286-in-
                 opencode-key pollution). Browser mode still needs it. -->
            <div v-if="!backend.isElectron" class="setting-section">
              <label class="setting-label">{{
                backend.activeBackendKind.value === "zero"
                  ? t("settings.zero")
                  : t("settings.opencode")
              }}</label>
              <div class="flex gap-2">
                <input
                  v-model="urlInput"
                  type="text"
                  :placeholder="urlPlaceholder"
                  :disabled="switching"
                  class="setting-input flex-1 disabled:opacity-50 disabled:cursor-wait"
                  @keydown.enter="applyUrl"
                />
                <button
                  class="px-3 py-2 text-xs font-medium rounded-lg transition-colors"
                  :class="
                    backend.connectionState.value === 'ready'
                      ? 'bg-accent-rose/15 text-accent-rose hover:bg-accent-rose/25'
                      : 'bg-accent-cyan/15 text-accent-cyan hover:bg-accent-cyan/25'
                  "
                  @click="
                    applyUrl();
                    toggleConnection();
                  "
                >
                  {{
                    backend.connectionState.value === "ready"
                      ? t("chat.abort")
                      : t("settings.connect")
                  }}
                </button>
              </div>
            </div>

            <!-- Authorization — also Electron-hidden, same reason. -->
            <div v-if="!backend.isElectron" class="setting-section">
              <label class="setting-label">Authorization</label>
              <input
                v-model="authInput"
                type="password"
                placeholder="Bearer ..."
                :disabled="switching"
                class="setting-input w-full disabled:opacity-50 disabled:cursor-wait"
                @keydown.enter="applyAuth"
              />
            </div>
          </template>

          <!-- ── Appearance tab ──────────────────────────────────────── -->
          <template v-else-if="activeTab === 'appearance'">
            <!-- Language -->
            <div class="setting-section">
              <label class="setting-label">{{ t("settings.language") }}</label>
              <div class="flex gap-2">
                <button
                  v-for="lang in languages"
                  :key="lang.value"
                  class="px-3 py-1.5 text-sm rounded-lg transition-colors"
                  :class="
                    selectedLang === lang.value
                      ? 'bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/30'
                      : 'bg-surface-800 text-surface-400 hover:text-surface-200 border border-transparent'
                  "
                  @click="changeLocale(lang.value)"
                >
                  {{ lang.label }}
                </button>
              </div>
            </div>

            <!-- Theme -->
            <div class="setting-section">
              <label class="setting-label">{{ t("settings.theme") }}</label>
              <div class="theme-grid">
                <button
                  v-for="th in themeList"
                  :key="th.id"
                  type="button"
                  class="theme-card"
                  :class="{ 'is-active': currentThemeId === th.id }"
                  :title="locale === 'zh-CN' ? th.name : th.nameEn"
                  @click="applyTheme(th.id)"
                >
                  <div class="theme-swatches">
                    <span
                      v-for="(c, i) in th.swatches"
                      :key="i"
                      class="theme-swatch"
                      :style="{ background: c }"
                    />
                  </div>
                  <div class="theme-name">
                    <span class="theme-name-text">{{
                      locale === "zh-CN" ? th.name : th.nameEn
                    }}</span>
                    <span class="theme-mode-tag" :class="th.mode">{{
                      th.mode === "dark" ? "D" : "L"
                    }}</span>
                  </div>
                </button>
              </div>
            </div>
          </template>

          <!-- ── About / Update tab ─────────────────────────────────── -->
          <template v-else-if="activeTab === 'about'">
            <!-- Current version + check for updates -->
            <div class="setting-section">
              <label class="setting-label">{{ t("update.section") }}</label>
              <div class="flex items-center gap-3">
                <span class="text-xs text-surface-400">
                  {{ t("update.currentVersion") }}:
                  <span class="text-surface-200 font-medium"
                    >v{{ update.currentVersion.value || "—" }}</span
                  >
                </span>
                <button
                  type="button"
                  class="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent-cyan/15 text-accent-cyan hover:bg-accent-cyan/25 transition-colors inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-wait"
                  :disabled="checking"
                  @click="checkForUpdates"
                >
                  <svg
                    class="w-3.5 h-3.5"
                    :class="checking ? 'animate-spin' : ''"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2.5"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  <span>{{ checking ? t("update.checking") : t("update.checkNow") }}</span>
                </button>
              </div>
              <!-- Live status line -->
              <p v-if="updateStatus" class="text-xs text-surface-400 mt-2">
                {{ updateStatus }}
              </p>
            </div>

            <!-- Auto-check toggle -->
            <div class="setting-section">
              <label class="setting-label">{{ t("update.autoCheck") }}</label>
              <button
                type="button"
                role="switch"
                :aria-checked="update.autoUpdate.value"
                class="toggle-switch"
                :class="{ 'is-on': update.autoUpdate.value }"
                @click="update.setAutoUpdate(!update.autoUpdate.value)"
              >
                <span class="toggle-knob" />
              </button>
              <p class="text-[11px] text-surface-500 mt-1.5">
                {{ t("update.autoCheckHint") }}
              </p>
            </div>

            <!-- Proxy -->
            <div class="setting-section">
              <label class="setting-label">{{ t("update.proxy") }}</label>
              <div class="flex gap-2">
                <input
                  v-model="proxyInput"
                  type="text"
                  :placeholder="t('update.proxyPlaceholder')"
                  class="setting-input flex-1"
                  @keydown.enter="applyProxy"
                />
                <button
                  class="px-3 py-2 text-xs font-medium rounded-lg bg-surface-800 text-surface-300 hover:bg-surface-700 hover:text-accent-cyan transition-colors"
                  @click="applyProxy"
                >
                  {{ t("update.proxyApply") }}
                </button>
              </div>
              <p class="text-[11px] text-surface-500 mt-1.5">
                {{ t("update.proxyHint") }}
              </p>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
}

.settings-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
}

.settings-panel {
  position: relative;
  width: 100%;
  max-width: 640px;
  max-height: calc(100vh - 4rem);
  display: flex;
  flex-direction: column;
  background: var(--color-surface-900, #18181b);
  border: 1px solid var(--color-surface-700, #334155);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid color-mix(in srgb, var(--color-surface-800, #27272a) 80%, transparent);
  flex: 0 0 auto;
}

.settings-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-surface-200, #e2e8f0);
}

.settings-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--color-surface-500, #64748b);
  cursor: pointer;
  transition:
    color 0.15s ease,
    background-color 0.15s ease;
}

.settings-close:hover {
  color: var(--color-surface-200, #e2e8f0);
  background: var(--color-surface-800, #27272a);
}

.settings-tabs {
  display: flex;
  gap: 0.25rem;
  padding: 0.6rem 1.25rem 0;
  border-bottom: 1px solid color-mix(in srgb, var(--color-surface-800, #27272a) 70%, transparent);
  flex: 0 0 auto;
}

.settings-tab {
  position: relative;
  padding: 0.5rem 0.9rem;
  border: 0;
  background: transparent;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-surface-500, #64748b);
  cursor: pointer;
  transition: color 0.15s ease;
}

.settings-tab:hover {
  color: var(--color-surface-200, #e2e8f0);
}

.settings-tab.is-active {
  color: var(--color-accent-cyan, #22d3ee);
}

.settings-tab.is-active::after {
  content: "";
  position: absolute;
  left: 0.6rem;
  right: 0.6rem;
  bottom: -1px;
  height: 2px;
  background: var(--color-accent-cyan, #22d3ee);
  border-radius: 2px;
}

.settings-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 1.25rem;
}

.setting-section {
  margin-bottom: 1.1rem;
}

.setting-section:last-child {
  margin-bottom: 0;
}

.setting-label {
  display: block;
  font-size: 13px;
  color: var(--color-surface-400, #94a3b8);
  margin-bottom: 0.5rem;
}

.setting-input {
  padding: 0.5rem 0.75rem;
  font-size: 13px;
  border-radius: 8px;
  background: var(--color-surface-800, #27272a);
  border: 1px solid var(--color-surface-700, #334155);
  color: var(--color-surface-100, #f4f4f5);
  transition: border-color 0.15s ease;
}

.setting-input::placeholder {
  color: var(--color-surface-600, #52525b);
}

.setting-input:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 50%, transparent);
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
}

.theme-card {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.5rem;
  border-radius: 8px;
  border: 1px solid var(--color-surface-700, #334155);
  background: var(--color-surface-800, #1e293b);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    transform 0.15s ease;
  text-align: left;
}

.theme-card:hover {
  border-color: var(--color-surface-500, #64748b);
  transform: translateY(-1px);
}

.theme-card.is-active {
  border-color: var(--color-accent-cyan, #22d3ee);
  box-shadow: 0 0 0 1px var(--color-accent-cyan, #22d3ee) inset;
}

.theme-swatches {
  display: flex;
  gap: 3px;
}

.theme-swatch {
  flex: 1 1 0;
  height: 14px;
  border-radius: 3px;
  border: 1px solid color-mix(in srgb, var(--color-surface-950, #000) 25%, transparent);
}

.theme-name {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
}

.theme-name-text {
  flex: 1;
  font-size: 12px;
  color: var(--color-surface-200, #e2e8f0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.theme-mode-tag {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
  color: #fff;
}

.theme-mode-tag.dark {
  background: #1e293b;
}

.theme-mode-tag.light {
  background: #f1f5f9;
  color: #0f172a;
}

/* Toggle switch (auto-update preference) */
.toggle-switch {
  position: relative;
  width: 38px;
  height: 22px;
  border: 0;
  border-radius: 11px;
  background: var(--color-surface-700, #334155);
  cursor: pointer;
  transition: background-color 0.18s ease;
  padding: 0;
}

.toggle-switch.is-on {
  background: var(--color-accent-cyan, #22d3ee);
}

.toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.18s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.toggle-switch.is-on .toggle-knob {
  transform: translateX(16px);
}
</style>
