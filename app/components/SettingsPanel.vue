<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Icon } from "@iconify/vue";
import { useI18n } from "vue-i18n";
import { useBackend } from "../composables/useBackend";
import { useTheme } from "../composables/useTheme";
import { StorageKeys, storageSet } from "../utils/storageKeys";
import { isElectron, openExternalUrl } from "../utils/electronBridge";
import { useUpdate } from "../composables/useUpdate";
import type { BackendKind } from "../backends/types";

const { t, locale } = useI18n();
const backend = useBackend();
const { currentThemeId, themes: themeList, applyTheme, followSystem, setFollowSystem } = useTheme();

defineProps<{
  modelValue: boolean;
}>();

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

const agentOptions: Array<{ kind: BackendKind; labelKey: string; description: string }> = [
  { kind: "opencode", labelKey: "settings.opencode", description: "Default coding agent" },
  { kind: "zero", labelKey: "settings.zero", description: "Alternative OpenCode-compatible agent" },
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
  if (switching.value) return;
  backend.setBaseUrl(urlInput.value.trim());
}

function applyAuth() {
  if (switching.value) return;
  backend.setAuthHeader(authInput.value.trim() || undefined);
}

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

// Stop the shared agent daemon. The server is decoupled from window
// lifecycle (survives close), so this is the explicit "release the port"
// switch. Useful when the user wants to fully reset state or free
// resources between sessions.
const stoppingAgent = ref(false);

async function stopAgentServer() {
  if (stoppingAgent.value) return;
  stoppingAgent.value = true;
  try {
    const { stopAgentServer: stop } = await import("../utils/electronBridge");
    await stop();
  } finally {
    stoppingAgent.value = false;
  }
}

const statusColor: Record<string, string> = {
  disconnected: "status-neutral",
  connecting: "status-warn",
  bootstrapping: "status-warn",
  ready: "status-ok",
  error: "status-error",
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

type SettingsTab = "about" | "backend" | "appearance";
const activeTab = ref<SettingsTab>("about");

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

const proxyInput = ref(update.proxy.value);
async function applyProxy() {
  await update.setProxy(proxyInput.value);
}

const updateStatus = computed(() => {
  const s = update.state.value.status;
  if (s === "checking") return t("update.checking");
  if (s === "progress") return `${t("update.downloading")} · ${update.state.value.percent}%`;
  if (s === "downloaded") return `${t("update.ready")} · v${update.state.value.version}`;
  if (s === "available") return `${t("update.available")} · v${update.state.value.version}`;
  if (s === "up-to-date") return t("update.upToDate");
  if (s === "error") return update.state.value.error || t("update.failed");
  return "";
});

const appVersion = computed(() => update.currentVersion.value || "0.4.0");
const latestVersion = computed(() => update.state.value.version || appVersion.value);
const releaseUrl = computed(
  () => `https://github.com/LevisBale0824/SpecForge/releases/tag/v${latestVersion.value}`,
);
const isUpToDate = computed(() => update.state.value.status === "up-to-date");
const hasUpdateTarget = computed(
  () =>
    ["available", "downloaded", "progress"].includes(update.state.value.status) &&
    !!update.state.value.version,
);
const lastCheckedText = computed(() => {
  if (!update.state.value.lastCheckedAt) return "";
  return new Intl.DateTimeFormat(locale.value, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(update.state.value.lastCheckedAt));
});

const navItems = computed(() => [
  { id: "about" as const, label: t("settings.tabAbout"), icon: "lucide:info" },
  { id: "backend" as const, label: t("settings.tabBackend"), icon: "lucide:server-cog" },
  { id: "appearance" as const, label: t("settings.tabAppearance"), icon: "lucide:palette" },
]);

const currentTitle = computed(
  () => navItems.value.find((item) => item.id === activeTab.value)?.label,
);

async function openExternalLink(url: string) {
  await openExternalUrl(url);
}

const linkGroups = computed(() => [
  {
    title: "反馈与社区",
    description: "查看项目动态、版本发布，并提交问题或建议。",
    links: [
      {
        icon: "lucide:github",
        title: "GitHub",
        description: "查看源码仓库和项目主页。",
        action: "View",
        href: "https://github.com/LevisBale0824/SpecForge",
      },
      {
        icon: "lucide:tag",
        title: "Release",
        description: "查看当前版本发布页和更新记录。",
        action: t("update.releaseLink"),
        href: releaseUrl.value,
      },
      {
        icon: "lucide:circle-alert",
        title: "Issues",
        description: "反馈缺陷或提出改进建议。",
        action: "Open",
        href: "https://github.com/LevisBale0824/SpecForge/issues",
      },
    ],
  },
]);
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="settings-shell">
      <aside class="settings-sidebar">
        <div class="sidebar-title">
          <div class="sidebar-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M6 8l-4 4 4 4" />
              <path d="M18 8l4 4-4 4" />
              <path d="M12 4v16" />
            </svg>
          </div>
          <div>
            <div class="sidebar-app">SpecForge</div>
            <div class="sidebar-subtitle">{{ t("settings.title") }}</div>
          </div>
        </div>

        <nav class="settings-nav" aria-label="Settings">
          <button
            v-for="item in navItems"
            :key="item.id"
            type="button"
            class="nav-item"
            :class="{ 'is-active': activeTab === item.id }"
            @click="activeTab = item.id"
          >
            <span class="nav-icon" aria-hidden="true"><Icon :icon="item.icon" /></span>
            <span>{{ item.label }}</span>
          </button>
        </nav>
      </aside>

      <main class="settings-main">
        <div class="settings-main-header">
          <div>
            <h1>{{ currentTitle }}</h1>
            <p v-if="activeTab === 'about'">AI coding collaboration workstation.</p>
            <p v-else-if="activeTab === 'backend'">Choose and control the local code agent.</p>
            <p v-else-if="activeTab === 'appearance'">Adjust language and visual theme.</p>
          </div>
        </div>

        <div class="settings-scroll">
          <template v-if="activeTab === 'about'">
            <section class="about-hero">
              <div class="app-logo" aria-hidden="true">
                <svg viewBox="0 0 256 256">
                  <defs>
                    <linearGradient id="settings-logo-grad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stop-color="#22d3ee" />
                      <stop offset="38%" stop-color="#6366f1" />
                      <stop offset="70%" stop-color="#10b981" />
                      <stop offset="100%" stop-color="#f59e0b" />
                    </linearGradient>
                  </defs>
                  <circle cx="128" cy="128" r="112" fill="url(#settings-logo-grad)" />
                  <path d="M96 80 L48 128 L96 176" />
                  <path d="M160 80 L208 128 L160 176" />
                  <circle cx="128" cy="128" r="16" />
                </svg>
              </div>
              <div class="about-copy">
                <h2>SpecForge</h2>
                <p>OpenSpec workflow and code-agent workspace for focused software changes.</p>
                <div class="version-row">
                  <span class="version-chip muted">v{{ appVersion }}</span>
                  <template v-if="hasUpdateTarget">
                    <span class="version-arrow">→</span>
                    <span class="version-chip">v{{ latestVersion }}</span>
                  </template>
                  <span v-else-if="isUpToDate" class="version-chip is-current">
                    {{ t("update.upToDate") }}
                  </span>
                </div>
              </div>
              <button
                v-if="inElectron"
                type="button"
                class="primary-button"
                :disabled="checking"
                @click="checkForUpdates"
              >
                {{ checking ? t("update.checking") : t("update.checkNow") }}
              </button>
            </section>

            <section v-if="inElectron" class="release-card">
              <div class="release-header">
                <div>
                  <h3>SpecForge v{{ hasUpdateTarget ? latestVersion : appVersion }}</h3>
                  <p>{{ updateStatus || t("update.autoCheckHint") }}</p>
                </div>
                <div class="release-actions">
                  <span v-if="isUpToDate" class="status-badge status-ok">
                    {{ t("update.upToDate") }}
                  </span>
                  <button
                    v-if="hasUpdateTarget"
                    type="button"
                    class="ghost-button"
                    @click="update.skipVersion(latestVersion)"
                  >
                    {{ t("update.ignore") }}
                  </button>
                  <button type="button" class="ghost-button" @click="openExternalLink(releaseUrl)">
                    {{ t("update.releaseLink") }}
                  </button>
                </div>
              </div>
              <div v-if="isUpToDate" class="current-version-note">
                <span class="current-check" aria-hidden="true">✓</span>
                <span>
                  <strong>{{ t("update.upToDate") }}</strong>
                  <small v-if="lastCheckedText">Last checked {{ lastCheckedText }}</small>
                </span>
              </div>
              <div v-else class="release-notes">
                <h4>Highlights</h4>
                <ul>
                  <li>OpenSpec workflow, proposal, task, and archive panels in one workspace.</li>
                  <li>Local agent switching with Electron-managed services.</li>
                  <li>Theme, language, update, and proxy preferences.</li>
                </ul>
              </div>
            </section>

            <section v-if="inElectron" class="update-preferences">
              <div class="update-preferences-head">
                <span class="row-icon" aria-hidden="true"
                  ><Icon icon="lucide:cloud-download"
                /></span>
                <span class="row-copy">
                  <strong>更新设置</strong>
                  <small>自动检查新版本，并配置访问 GitHub 使用的代理。</small>
                </span>
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
              </div>

              <div class="proxy-control">
                <label>{{ t("update.proxy") }}</label>
                <div class="input-row">
                  <input
                    v-model="proxyInput"
                    type="text"
                    :placeholder="t('update.proxyPlaceholder')"
                    class="setting-input"
                    @keydown.enter="applyProxy"
                  />
                  <button type="button" class="row-action" @click="applyProxy">
                    {{ t("update.proxyApply") }}
                  </button>
                </div>
                <p>{{ t("update.proxyHint") }}</p>
              </div>
            </section>

            <section class="link-groups">
              <div v-for="group in linkGroups" :key="group.title" class="link-group">
                <div class="link-group-heading">
                  <h2>{{ group.title }}</h2>
                  <p>{{ group.description }}</p>
                </div>
                <div class="link-grid">
                  <button
                    v-for="link in group.links"
                    :key="link.title"
                    type="button"
                    class="link-card"
                    @click="openExternalLink(link.href)"
                  >
                    <span class="row-icon" aria-hidden="true"><Icon :icon="link.icon" /></span>
                    <span class="row-copy">
                      <strong>{{ link.title }}</strong>
                      <small>{{ link.description }}</small>
                    </span>
                    <span class="row-action">{{ link.action }}</span>
                  </button>
                </div>
              </div>
            </section>
          </template>

          <template v-else-if="activeTab === 'backend'">
            <section class="settings-card">
              <div class="section-heading">
                <h2>{{ t("settings.backend") }}</h2>
                <span class="status-pill" :class="statusColor[backend.connectionState.value]">
                  {{ t(statusText[backend.connectionState.value] ?? "status.disconnected") }}
                </span>
              </div>
              <p v-if="backend.errorMessage.value" class="error-text">
                {{ backend.errorMessage.value }}
              </p>

              <div class="agent-grid">
                <button
                  v-for="opt in agentOptions"
                  :key="opt.kind"
                  type="button"
                  class="agent-card"
                  :class="{ 'is-active': backend.activeBackendKind.value === opt.kind }"
                  :disabled="switching"
                  @click="selectAgent(opt.kind)"
                >
                  <span class="agent-indicator" />
                  <strong>{{ t(opt.labelKey) }}</strong>
                  <small>{{ opt.description }}</small>
                </button>
              </div>
            </section>

            <section class="settings-list">
              <div class="settings-row">
                <span class="row-icon" aria-hidden="true"><Icon icon="lucide:rotate-cw" /></span>
                <span class="row-copy">
                  <strong>{{ t("settings.restartAgent") }}</strong>
                  <small>Restart the current managed local agent process.</small>
                </span>
                <button
                  type="button"
                  class="row-action"
                  :disabled="!backend.isElectron || restarting"
                  @click="restartAgent"
                >
                  {{ restarting ? t("settings.restarting") : t("settings.restartAgent") }}
                </button>
              </div>

              <div v-if="backend.isElectron" class="settings-row">
                <span class="row-icon" aria-hidden="true"><Icon icon="lucide:power" /></span>
                <span class="row-copy">
                  <strong>{{ t("settings.stopAgent") }}</strong>
                  <small>{{ t("settings.stopAgentHint") }}</small>
                </span>
                <button
                  type="button"
                  class="row-action danger"
                  :disabled="!backend.isElectron || stoppingAgent"
                  @click="stopAgentServer"
                >
                  {{ stoppingAgent ? t("settings.stoppingAgent") : t("settings.stopAgent") }}
                </button>
              </div>

              <div v-if="!backend.isElectron" class="settings-row stacked">
                <span class="row-icon" aria-hidden="true"><Icon icon="lucide:plug-zap" /></span>
                <span class="row-copy wide">
                  <strong>{{
                    backend.activeBackendKind.value === "zero"
                      ? t("settings.zero")
                      : t("settings.opencode")
                  }}</strong>
                  <small>Connect to a manually started server in browser mode.</small>
                  <span class="input-row">
                    <input
                      v-model="urlInput"
                      type="text"
                      :placeholder="urlPlaceholder"
                      :disabled="switching"
                      class="setting-input"
                      @keydown.enter="applyUrl"
                    />
                    <button
                      type="button"
                      class="row-action"
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
                  </span>
                </span>
              </div>

              <div v-if="!backend.isElectron" class="settings-row stacked">
                <span class="row-icon" aria-hidden="true"><Icon icon="lucide:key-round" /></span>
                <span class="row-copy wide">
                  <strong>Authorization</strong>
                  <small>Optional bearer token for the selected backend.</small>
                  <input
                    v-model="authInput"
                    type="password"
                    placeholder="Bearer ..."
                    :disabled="switching"
                    class="setting-input"
                    @keydown.enter="applyAuth"
                  />
                </span>
              </div>
            </section>
          </template>

          <template v-else-if="activeTab === 'appearance'">
            <section class="settings-card">
              <div class="section-heading">
                <h2>{{ t("settings.language") }}</h2>
              </div>
              <div class="segmented">
                <button
                  v-for="lang in languages"
                  :key="lang.value"
                  type="button"
                  :class="{ 'is-active': selectedLang === lang.value }"
                  @click="changeLocale(lang.value)"
                >
                  {{ lang.label }}
                </button>
              </div>
            </section>

            <section class="settings-card">
              <div class="section-heading">
                <h2>{{ t("settings.theme") }}</h2>
              </div>

              <label class="follow-system-row">
                <span class="follow-system-label">
                  <span class="follow-system-title">{{ t("settings.followSystem") }}</span>
                  <small class="follow-system-hint">{{ t("settings.followSystemHint") }}</small>
                </span>
                <button
                  type="button"
                  class="toggle-switch"
                  role="switch"
                  :aria-checked="followSystem"
                  :class="{ 'is-on': followSystem }"
                  @click="setFollowSystem(!followSystem)"
                >
                  <span class="toggle-thumb" />
                </button>
              </label>

              <div class="theme-grid" :class="{ 'is-disabled': followSystem }">
                <button
                  v-for="th in themeList"
                  :key="th.id"
                  type="button"
                  class="theme-card"
                  :class="{ 'is-active': currentThemeId === th.id }"
                  :disabled="followSystem"
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
                    <span>{{ locale === "zh-CN" ? th.name : th.nameEn }}</span>
                    <small>{{ th.mode }}</small>
                  </div>
                </button>
              </div>
            </section>
          </template>
        </div>
      </main>
    </div>
  </Teleport>
</template>

<style scoped>
.settings-shell {
  position: fixed;
  top: 2.5rem;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 90;
  display: grid;
  grid-template-columns: 224px minmax(0, 1fr);
  color: var(--color-surface-200, #e4e4e7);
  background:
    radial-gradient(
      circle at 80% 0%,
      color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 12%, transparent),
      transparent 26rem
    ),
    var(--color-surface-950, #09090b);
}

.settings-sidebar {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem 0.9rem;
  background: color-mix(in srgb, var(--color-surface-900, #18181b) 88%, transparent);
  border-right: 1px solid color-mix(in srgb, var(--color-surface-700, #3f3f46) 58%, transparent);
}

.sidebar-title {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0 0.35rem 0.6rem;
}

.sidebar-mark {
  width: 2rem;
  height: 2rem;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 8px;
  background: color-mix(
    in srgb,
    var(--color-accent-cyan, #22d3ee) 18%,
    var(--color-surface-800, #27272a)
  );
  color: var(--color-accent-cyan, #22d3ee);
}

.sidebar-mark svg {
  width: 1.1rem;
  height: 1.1rem;
  display: block;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.sidebar-app {
  font-size: 0.9rem;
  font-weight: 700;
  line-height: 1.2;
  color: var(--color-surface-100, #f4f4f5);
}

.sidebar-subtitle {
  margin-top: 0.1rem;
  font-size: 0.72rem;
  color: var(--color-surface-500, #71717a);
}

.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.nav-item {
  width: 100%;
  min-height: 2.5rem;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.55rem 0.7rem;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-surface-400, #a1a1aa);
  font-size: 0.84rem;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition:
    background-color 0.16s ease,
    color 0.16s ease;
}

.nav-item:hover {
  color: var(--color-surface-100, #f4f4f5);
  background: color-mix(in srgb, var(--color-surface-800, #27272a) 72%, transparent);
}

.nav-item.is-active {
  color: white;
  background: linear-gradient(
    135deg,
    var(--color-accent-cyan, #22d3ee),
    var(--color-accent-indigo, #818cf8)
  );
  box-shadow: 0 10px 26px color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 22%, transparent);
}

.nav-icon,
.row-icon {
  flex: 0 0 auto;
}

.nav-icon svg,
.row-icon svg {
  width: 1rem;
  height: 1rem;
  display: block;
}

.settings-main {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.settings-main-header {
  width: 100%;
  max-width: 92rem;
  margin: 0 auto;
  box-sizing: border-box;
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 2rem 2rem 1rem;
}

.settings-main-header h1 {
  margin: 0;
  color: var(--color-surface-100, #f4f4f5);
  font-size: 1.35rem;
  font-weight: 750;
  line-height: 1.2;
}

.settings-main-header p {
  margin: 0.45rem 0 0;
  color: var(--color-surface-500, #71717a);
  font-size: 0.85rem;
}

.settings-scroll {
  width: 100%;
  max-width: 92rem;
  margin: 0 auto;
  box-sizing: border-box;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0 2rem 2.2rem;
}

.settings-scroll > * + * {
  margin-top: 1rem;
}

.about-hero,
.settings-card,
.release-card,
.settings-list,
.update-preferences,
.link-group {
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #3f3f46) 58%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-surface-900, #18181b) 72%, transparent);
}

.about-hero {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 1rem;
  padding: 1.4rem;
}

.app-logo {
  width: 4.8rem;
  height: 4.8rem;
  flex: 0 0 auto;
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.28);
}

.app-logo svg {
  width: 100%;
  height: 100%;
  display: block;
}

.app-logo path {
  fill: none;
  stroke: white;
  stroke-width: 24;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.app-logo circle:last-child {
  fill: white;
}

.about-copy h2 {
  margin: 0;
  color: var(--color-surface-100, #f4f4f5);
  font-size: 1.35rem;
  font-weight: 780;
}

.about-copy p {
  margin: 0.35rem 0 0;
  color: var(--color-surface-400, #a1a1aa);
  font-size: 0.9rem;
}

.version-row,
.release-actions,
.input-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.version-row {
  margin-top: 0.65rem;
}

.version-chip {
  display: inline-flex;
  align-items: center;
  min-height: 1.45rem;
  padding: 0.18rem 0.55rem;
  border-radius: 6px;
  background: color-mix(
    in srgb,
    var(--color-accent-emerald, #34d399) 18%,
    var(--color-surface-800, #27272a)
  );
  color: var(--color-accent-emerald, #34d399);
  font-size: 0.75rem;
  font-weight: 750;
}

.version-chip.muted {
  background: color-mix(in srgb, var(--color-surface-800, #27272a) 86%, transparent);
  color: var(--color-surface-300, #d4d4d8);
}

.version-chip.is-current {
  background: color-mix(in srgb, var(--color-accent-emerald, #34d399) 14%, transparent);
  color: var(--color-accent-emerald, #34d399);
}

.version-arrow {
  color: var(--color-surface-500, #71717a);
}

.primary-button,
.ghost-button,
.row-action {
  min-height: 2rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 650;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  transition:
    transform 0.15s ease,
    background-color 0.15s ease,
    color 0.15s ease;
}

.primary-button {
  padding: 0.45rem 0.85rem;
  color: white;
  background: linear-gradient(
    135deg,
    var(--color-accent-cyan, #22d3ee),
    var(--color-accent-indigo, #818cf8)
  );
}

.primary-button:hover,
.row-action:hover {
  transform: translateY(-1px);
}

.primary-button:disabled,
.row-action:disabled,
.agent-card:disabled {
  opacity: 0.5;
  cursor: wait;
  transform: none;
}

.release-card,
.settings-card,
.update-preferences,
.link-group {
  padding: 1rem;
}

.release-header,
.section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.release-header h3,
.section-heading h2 {
  margin: 0;
  color: var(--color-surface-100, #f4f4f5);
  font-size: 0.98rem;
  font-weight: 750;
}

.release-header p,
.muted-line {
  margin: 0.35rem 0 0;
  color: var(--color-surface-500, #71717a);
  font-size: 0.8rem;
}

.status-badge {
  min-height: 1.8rem;
  display: inline-flex;
  align-items: center;
  border-radius: 6px;
  padding: 0.28rem 0.65rem;
  background: color-mix(
    in srgb,
    var(--color-accent-emerald, #34d399) 12%,
    var(--color-surface-800, #27272a)
  );
  border: 1px solid color-mix(in srgb, var(--color-accent-emerald, #34d399) 22%, transparent);
  color: var(--color-accent-emerald, #34d399);
  font-size: 0.76rem;
  font-weight: 700;
  white-space: nowrap;
}

.current-version-note,
.release-notes {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid color-mix(in srgb, var(--color-surface-700, #3f3f46) 45%, transparent);
}

.current-version-note {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  color: var(--color-surface-300, #d4d4d8);
}

.current-check {
  width: 2rem;
  height: 2rem;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-accent-emerald, #34d399) 16%, transparent);
  color: var(--color-accent-emerald, #34d399);
  font-weight: 800;
}

.current-version-note span:last-child {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.current-version-note strong {
  color: var(--color-surface-200, #e4e4e7);
  font-size: 0.86rem;
}

.current-version-note small {
  color: var(--color-surface-500, #71717a);
  font-size: 0.75rem;
}

.ghost-button,
.row-action {
  padding: 0.35rem 0.65rem;
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #3f3f46) 55%, transparent);
  background: color-mix(in srgb, var(--color-surface-800, #27272a) 42%, transparent);
  color: var(--color-surface-300, #d4d4d8);
}

.ghost-button:hover,
.row-action:hover {
  color: var(--color-surface-100, #f4f4f5);
  background: color-mix(in srgb, var(--color-surface-700, #3f3f46) 42%, transparent);
}

.release-notes h4 {
  margin: 0 0 0.65rem;
  color: var(--color-surface-200, #e4e4e7);
  font-size: 0.86rem;
}

.release-notes ul {
  margin: 0;
  padding-left: 1rem;
  color: var(--color-surface-400, #a1a1aa);
  font-size: 0.82rem;
  line-height: 1.65;
}

.settings-list {
  overflow: hidden;
}

.update-preferences-head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.85rem;
}

.proxy-control {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid color-mix(in srgb, var(--color-surface-700, #3f3f46) 38%, transparent);
}

.proxy-control label {
  display: block;
  margin-bottom: 0.45rem;
  color: var(--color-surface-300, #d4d4d8);
  font-size: 0.8rem;
  font-weight: 700;
}

.proxy-control p {
  margin: 0.45rem 0 0;
  color: var(--color-surface-500, #71717a);
  font-size: 0.73rem;
  line-height: 1.45;
}

.link-groups {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
}

.link-group-heading {
  margin-bottom: 0.85rem;
}

.link-group-heading h2 {
  margin: 0;
  color: var(--color-surface-100, #f4f4f5);
  font-size: 0.95rem;
  font-weight: 750;
}

.link-group-heading p {
  margin: 0.28rem 0 0;
  color: var(--color-surface-500, #71717a);
  font-size: 0.76rem;
}

.link-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
  gap: 0.65rem;
}

.link-card {
  width: 100%;
  min-height: 4.3rem;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.85rem;
  padding: 0.8rem;
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #3f3f46) 42%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-surface-800, #27272a) 28%, transparent);
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.link-card:hover {
  background: color-mix(in srgb, var(--color-surface-800, #27272a) 48%, transparent);
  border-color: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 28%, transparent);
}

.settings-row {
  width: 100%;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.85rem;
  min-height: 4.1rem;
  padding: 0.8rem 0.9rem;
  border-bottom: 1px solid color-mix(in srgb, var(--color-surface-700, #3f3f46) 38%, transparent);
  border-left: 0;
  border-right: 0;
  border-top: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  text-decoration: none;
}

.settings-row:last-child {
  border-bottom: 0;
}

.settings-row.stacked {
  align-items: flex-start;
}

.row-icon {
  width: 2rem;
  height: 2rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: color-mix(
    in srgb,
    var(--color-accent-cyan, #22d3ee) 13%,
    var(--color-surface-800, #27272a)
  );
  color: var(--color-accent-cyan, #22d3ee);
}

.row-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.row-copy.wide {
  gap: 0.55rem;
}

.row-copy strong {
  color: var(--color-surface-200, #e4e4e7);
  font-size: 0.84rem;
  font-weight: 700;
}

.row-copy small {
  color: var(--color-surface-500, #71717a);
  font-size: 0.76rem;
  line-height: 1.45;
}

.row-action.static {
  cursor: default;
  transform: none;
}

.error-text {
  margin: 0.75rem 0 0;
  color: var(--color-accent-rose, #fb7185);
  font-size: 0.78rem;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 1.5rem;
  padding: 0.18rem 0.55rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--color-surface-300, #d4d4d8);
  background: color-mix(in srgb, var(--color-surface-700, #3f3f46) 45%, transparent);
}

.status-pill::before {
  content: "";
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 999px;
  background: currentColor;
}

.status-ok {
  color: var(--color-accent-emerald, #34d399);
}

.status-warn {
  color: var(--color-accent-amber, #fbbf24);
}

.status-error {
  color: var(--color-accent-rose, #fb7185);
}

.status-neutral {
  color: var(--color-surface-500, #71717a);
}

.agent-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin-top: 1rem;
}

.agent-card {
  position: relative;
  min-height: 5.2rem;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
  padding: 0.85rem;
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #3f3f46) 58%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-surface-800, #27272a) 38%, transparent);
  color: var(--color-surface-300, #d4d4d8);
  text-align: left;
  cursor: pointer;
}

.agent-card:hover {
  border-color: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 45%, transparent);
}

.agent-card.is-active {
  border-color: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 70%, transparent);
  background: color-mix(
    in srgb,
    var(--color-accent-cyan, #22d3ee) 12%,
    var(--color-surface-800, #27272a)
  );
}

.agent-card strong {
  color: var(--color-surface-100, #f4f4f5);
  font-size: 0.9rem;
}

.agent-card small {
  color: var(--color-surface-500, #71717a);
  font-size: 0.75rem;
}

.agent-indicator {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 999px;
  background: var(--color-surface-600, #52525b);
}

.agent-card.is-active .agent-indicator {
  background: var(--color-accent-emerald, #34d399);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-accent-emerald, #34d399) 14%, transparent);
}

.segmented {
  display: inline-flex;
  gap: 0.25rem;
  margin-top: 0.85rem;
  padding: 0.25rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-surface-800, #27272a) 68%, transparent);
}

.segmented button {
  min-width: 6rem;
  min-height: 2rem;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-surface-400, #a1a1aa);
  font-size: 0.8rem;
  font-weight: 650;
  cursor: pointer;
}

.segmented button.is-active {
  color: var(--color-surface-100, #f4f4f5);
  background: color-mix(
    in srgb,
    var(--color-accent-cyan, #22d3ee) 22%,
    var(--color-surface-700, #3f3f46)
  );
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
  gap: 0.75rem;
  margin-top: 0.85rem;
}

.theme-grid.is-disabled {
  opacity: 0.45;
  pointer-events: none;
}

.follow-system-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.65rem 0.75rem;
  margin-top: 0.85rem;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #3f3f46) 50%, transparent);
  background: color-mix(in srgb, var(--color-surface-800, #27272a) 30%, transparent);
}

.follow-system-label {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.follow-system-title {
  font-size: 0.85rem;
  font-weight: 650;
  color: var(--color-surface-200, #e4e4e7);
}

.follow-system-hint {
  font-size: 0.72rem;
  color: var(--color-surface-500, #71717a);
  line-height: 1.35;
}

.toggle-switch {
  flex: 0 0 auto;
  position: relative;
  width: 38px;
  height: 22px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #3f3f46) 70%, transparent);
  background: color-mix(in srgb, var(--color-surface-900, #18181b) 80%, transparent);
  cursor: pointer;
  padding: 0;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.toggle-switch.is-on {
  background: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 40%, transparent);
  border-color: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 60%, transparent);
}

.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-surface-200, #e4e4e7);
  transition: transform 0.15s ease;
}

.toggle-switch.is-on .toggle-thumb {
  transform: translateX(16px);
}

.theme-card {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  padding: 0.7rem;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #3f3f46) 58%, transparent);
  background: color-mix(in srgb, var(--color-surface-800, #27272a) 36%, transparent);
  cursor: pointer;
  text-align: left;
}

.theme-card:disabled {
  cursor: not-allowed;
}

.theme-card:hover,
.theme-card.is-active {
  border-color: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 70%, transparent);
}

.theme-card.is-active {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 46%, transparent) inset;
}

.theme-swatches {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0.25rem;
}

.theme-swatch {
  height: 1.4rem;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.2);
}

.theme-name {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  color: var(--color-surface-200, #e4e4e7);
  font-size: 0.8rem;
  font-weight: 650;
}

.theme-name span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.theme-name small {
  color: var(--color-surface-500, #71717a);
  font-size: 0.68rem;
  text-transform: uppercase;
}

.setting-input {
  width: 100%;
  min-height: 2.1rem;
  padding: 0.45rem 0.65rem;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #3f3f46) 70%, transparent);
  background: color-mix(in srgb, var(--color-surface-950, #09090b) 44%, transparent);
  color: var(--color-surface-100, #f4f4f5);
  font-size: 0.8rem;
}

.setting-input::placeholder {
  color: var(--color-surface-600, #52525b);
}

.setting-input:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 68%, transparent);
}

.input-row .setting-input {
  flex: 1 1 auto;
  min-width: 0;
}

.toggle-switch {
  position: relative;
  width: 2.35rem;
  height: 1.35rem;
  border: 0;
  border-radius: 999px;
  background: var(--color-surface-700, #3f3f46);
  cursor: pointer;
  padding: 0;
}

.toggle-switch.is-on {
  background: var(--color-accent-cyan, #22d3ee);
}

.toggle-knob {
  position: absolute;
  top: 0.15rem;
  left: 0.15rem;
  width: 1.05rem;
  height: 1.05rem;
  border-radius: 999px;
  background: white;
  transition: transform 0.18s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.32);
}

.toggle-switch.is-on .toggle-knob {
  transform: translateX(1rem);
}
@media (max-width: 760px) {
  .settings-shell {
    grid-template-columns: 1fr;
  }

  .settings-sidebar {
    flex-direction: row;
    align-items: center;
    overflow-x: auto;
    padding: 0.7rem;
    border-right: 0;
    border-bottom: 1px solid color-mix(in srgb, var(--color-surface-700, #3f3f46) 58%, transparent);
  }

  .sidebar-title {
    display: none;
  }

  .settings-nav {
    flex-direction: row;
  }

  .nav-item {
    width: auto;
    white-space: nowrap;
  }

  .settings-main-header,
  .settings-scroll {
    max-width: none;
    padding-left: 1rem;
    padding-right: 1rem;
  }

  .about-hero {
    grid-template-columns: 1fr;
  }

  .agent-grid {
    grid-template-columns: 1fr;
  }

  .link-groups {
    grid-template-columns: 1fr;
  }

  .link-card,
  .update-preferences-head,
  .settings-row {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .link-card > .row-action,
  .update-preferences-head > .toggle-switch,
  .settings-row > .row-action,
  .settings-row > .toggle-switch,
  .settings-row > .status-pill {
    grid-column: 2;
    justify-self: start;
  }

  .input-row {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
