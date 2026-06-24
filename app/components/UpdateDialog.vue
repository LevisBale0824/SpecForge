<script setup lang="ts">
// ---------------------------------------------------------------------------
// UpdateDialog — modal update prompt with version comparison + release notes
// ---------------------------------------------------------------------------
// Replaces the previous Toast for `available` / `progress` / `downloaded`
// states. Shown automatically when an update is available (auto or manual
// check). Toast remains for `up-to-date` / `error` feedback only.
//
// Layout (mirrors NoteGen's pattern):
//   ┌─────────────────────────────────────────────┐
//   │ [logo]  SpecForge                       [X] │
//   │ 一款 AI 编程协作工作站                       │
//   │ v0.3.1 → v0.3.2                              │
//   ├─────────────────────────────────────────────┤
//   │ SpecForge v0.3.2                             │
//   │ Release                                      │
//   │ <markdown release notes>                     │
//   ├─────────────────────────────────────────────┤
//   │ [忽略此版本] [Release]      [更新至最新版本] │
//   └─────────────────────────────────────────────┘
// In progress state the buttons are replaced by a progress bar; in
// downloaded state only "Restart & Install" remains.
// ---------------------------------------------------------------------------

import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useUpdate } from "../composables/useUpdate";
import { useMarkdown } from "../composables/useMarkdown";
import { isElectron } from "../utils/electronBridge";

const { t } = useI18n();
const { render: renderMarkdown } = useMarkdown();
const inElectron = isElectron();
const { state, releaseNotes, currentVersion, downloadUpdate, installUpdate, skipVersion } =
  useUpdate();

/**
 * Convert release notes to HTML for v-html binding.
 * Different update sources return notes in different formats:
 *   - Raw markdown (e.g. `### 新增\n- xxx`) — run through markdown-it
 *   - Pre-rendered HTML (e.g. GitHub `body_html`) — use as-is
 * Detect HTML by looking for typical block-level tag patterns; pass through
 * when matched to avoid markdown-it escaping existing HTML into entities.
 */
function toReleaseNotesHtml(content: string): string {
  const trimmed = (content || "").trim();
  if (!trimmed) return "";
  const looksLikeHtml =
    /^<(\w+)(\s[^>]*)?>/.test(trimmed) ||
    /<\/(h[1-6]|ul|ol|li|div|p|pre|code)(\s[^>]*)?>/.test(trimmed);
  return looksLikeHtml ? trimmed : renderMarkdown(trimmed);
}

// User-dismissed flag: stays dismissed until either a new version shows up
// or the user manually re-opens via Settings → About.
const dismissed = ref(false);
const lastDismissedVersion = ref("");

// Visible whenever there's something to act on, unless the user dismissed
// the current version.
const visible = computed(() => {
  if (!inElectron) return false;
  const s = state.value.status;
  if (s !== "available" && s !== "progress" && s !== "downloaded") return false;
  if (dismissed.value && state.value.version === lastDismissedVersion.value) return false;
  return true;
});

const releaseNotesHtml = computed(() => toReleaseNotesHtml(releaseNotes.value));

const downloading = ref(false);
async function startDownload() {
  if (downloading.value) return;
  downloading.value = true;
  await downloadUpdate();
  // Once progress events arrive the dialog will switch to progress view.
  // `downloading` flag stays true so the button shows a spinner until then.
}

const installing = ref(false);
async function restart() {
  if (installing.value) return;
  installing.value = true;
  await installUpdate();
}

function close() {
  dismissed.value = true;
  lastDismissedVersion.value = state.value.version;
}

async function ignore() {
  await skipVersion(state.value.version);
  // skipVersion already resets state; ensure dismissed also reflects this.
  dismissed.value = false;
}

// Release page link for the upcoming version.
const releaseUrl = computed(
  () => `https://github.com/LevisBale0824/SpecForge/releases/tag/v${state.value.version}`,
);
</script>

<template>
  <Teleport to="body">
    <Transition name="update-dialog">
      <div v-if="visible" class="ud-overlay">
        <div class="ud-backdrop" @click="close" />
        <div class="ud-dialog" role="dialog" aria-modal="true" aria-label="Update available">
          <!-- Header: app identity + version -->
          <header class="ud-header">
            <div class="ud-brand">
              <svg
                class="ud-logo"
                viewBox="0 0 256 256"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="update-logo-grad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="#22d3ee" />
                    <stop offset="33%" stop-color="#6366f1" />
                    <stop offset="66%" stop-color="#10b981" />
                    <stop offset="100%" stop-color="#f59e0b" />
                  </linearGradient>
                </defs>
                <circle cx="128" cy="128" r="112" fill="url(#update-logo-grad)" />
                <path
                  d="M96 80 L48 128 L96 176"
                  stroke="white"
                  stroke-width="24"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  fill="none"
                />
                <path
                  d="M160 80 L208 128 L160 176"
                  stroke="white"
                  stroke-width="24"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  fill="none"
                />
                <circle cx="128" cy="128" r="16" fill="white" />
                <circle cx="128" cy="128" r="8" fill="#0f172a" />
              </svg>
              <div class="ud-brand-text">
                <div class="ud-app-name">SpecForge</div>
                <div class="ud-app-tagline">{{ t("update.tagline") }}</div>
              </div>
            </div>
            <button class="ud-close" :title="t('common.close')" @click="close">
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

          <!-- Version row -->
          <div class="ud-version-row">
            <span class="ud-version-chip ud-version-current">v{{ currentVersion }}</span>
            <svg class="ud-arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2.5"
                d="M13 5l7 7-7 7M5 12h15"
              />
            </svg>
            <span class="ud-version-chip ud-version-new">v{{ state.version }}</span>
          </div>

          <!-- Body: release notes -->
          <div class="ud-body">
            <div class="ud-release-title">SpecForge v{{ state.version }}</div>
            <a
              :href="releaseUrl"
              target="_blank"
              rel="noopener"
              class="ud-release-link"
              :title="t('update.releaseLinkHint')"
            >
              {{ t("update.releaseLink") }}
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </a>
            <!-- Progress view replaces notes during download -->
            <div v-if="state.status === 'progress'" class="ud-progress-block">
              <div class="ud-progress-track">
                <div class="ud-progress-bar" :style="{ width: state.percent + '%' }" />
              </div>
              <div class="ud-progress-meta">{{ state.percent }}%</div>
            </div>
            <!-- Otherwise show markdown release notes -->
            <div v-else class="ud-notes" v-html="releaseNotesHtml" />
          </div>

          <!-- Footer: actions -->
          <footer class="ud-footer">
            <!-- Available state: ignore / update -->
            <template v-if="state.status === 'available'">
              <button class="ud-btn ud-btn-ghost" @click="ignore">
                {{ t("update.ignore") }}
              </button>
              <div class="ud-footer-spacer" />
              <button class="ud-btn ud-btn-primary" :disabled="downloading" @click="startDownload">
                <svg
                  v-if="downloading"
                  class="w-3.5 h-3.5 animate-spin"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path stroke-linecap="round" stroke-width="2" d="M4 12a8 8 0 018-8" />
                </svg>
                <span>{{ downloading ? t("update.preparing") : t("update.downloadNow") }}</span>
              </button>
            </template>

            <!-- Progress state: disable all but show note -->
            <template v-else-if="state.status === 'progress'">
              <div class="ud-progress-hint">{{ t("update.downloadingHint") }}</div>
              <div class="ud-footer-spacer" />
              <span class="ud-btn ud-btn-disabled">{{ t("update.downloading") }}</span>
            </template>

            <!-- Downloaded state: only restart -->
            <template v-else-if="state.status === 'downloaded'">
              <div class="ud-ready-note">{{ t("update.readyHint") }}</div>
              <div class="ud-footer-spacer" />
              <button class="ud-btn ud-btn-primary" :disabled="installing" @click="restart">
                <svg
                  v-if="installing"
                  class="w-3.5 h-3.5 animate-spin"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path stroke-linecap="round" stroke-width="2" d="M4 12a8 8 0 018-8" />
                </svg>
                <span>{{ t("update.install") }}</span>
              </button>
            </template>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ud-overlay {
  position: fixed;
  inset: 0;
  z-index: 10002;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
}

.ud-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
}

.ud-dialog {
  position: relative;
  width: 100%;
  max-width: 480px;
  max-height: calc(100vh - 4rem);
  display: flex;
  flex-direction: column;
  background: var(--color-surface-900, #18181b);
  border: 1px solid var(--color-surface-700, #334155);
  border-radius: 12px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  color: var(--color-surface-100, #f4f4f5);
}

.ud-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 1.1rem 1.25rem 0.85rem;
  border-bottom: 1px solid color-mix(in srgb, var(--color-surface-800, #27272a) 70%, transparent);
}

.ud-brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.ud-logo {
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
}

.ud-brand-text {
  min-width: 0;
}

.ud-app-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-surface-100, #f4f4f5);
  line-height: 1.2;
}

.ud-app-tagline {
  margin-top: 2px;
  font-size: 11px;
  color: var(--color-surface-500, #64748b);
}

.ud-close {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.3rem;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-surface-500, #64748b);
  cursor: pointer;
  transition:
    color 0.15s ease,
    background-color 0.15s ease;
}

.ud-close:hover {
  color: var(--color-surface-200, #e2e8f0);
  background: var(--color-surface-800, #27272a);
}

.ud-version-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.85rem 1.25rem;
  border-bottom: 1px solid color-mix(in srgb, var(--color-surface-800, #27272a) 60%, transparent);
}

.ud-version-chip {
  font-size: 12px;
  font-weight: 600;
  padding: 0.25rem 0.55rem;
  border-radius: 4px;
  border: 1px solid transparent;
}

.ud-version-current {
  color: var(--color-surface-400, #94a3b8);
  background: var(--color-surface-800, #27272a);
  border-color: var(--color-surface-700, #334155);
}

.ud-version-new {
  color: var(--color-accent-cyan, #22d3ee);
  background: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 15%, transparent);
  border-color: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 40%, transparent);
}

.ud-arrow {
  width: 14px;
  height: 14px;
  color: var(--color-surface-500, #64748b);
}

.ud-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 1rem 1.25rem;
}

.ud-release-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-surface-200, #e2e8f0);
}

.ud-release-link {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  margin-top: 0.25rem;
  font-size: 11px;
  color: var(--color-accent-cyan, #22d3ee);
  text-decoration: none;
}

.ud-release-link:hover {
  text-decoration: underline;
}

.ud-notes {
  margin-top: 0.75rem;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-surface-300, #cbd5e1);
}

.ud-notes :deep(h1),
.ud-notes :deep(h2),
.ud-notes :deep(h3) {
  font-size: 12px;
  font-weight: 700;
  margin: 0.75rem 0 0.35rem;
  color: var(--color-surface-200, #e2e8f0);
}

.ud-notes :deep(h3:first-child) {
  margin-top: 0;
}

.ud-notes :deep(ul),
.ud-notes :deep(ol) {
  padding-left: 1.1rem;
  margin: 0.35rem 0;
}

.ud-notes :deep(li) {
  margin: 0.15rem 0;
}

.ud-notes :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--color-surface-800, #27272a);
  color: var(--color-accent-cyan, #22d3ee);
}

.ud-notes :deep(a) {
  color: var(--color-accent-cyan, #22d3ee);
  text-decoration: none;
}

.ud-notes :deep(a:hover) {
  text-decoration: underline;
}

.ud-progress-block {
  margin-top: 0.75rem;
}

.ud-progress-track {
  height: 6px;
  background: var(--color-surface-800, #27272a);
  border-radius: 3px;
  overflow: hidden;
}

.ud-progress-bar {
  height: 100%;
  background: var(--color-accent-cyan, #22d3ee);
  border-radius: 3px;
  transition: width 0.2s ease;
}

.ud-progress-meta {
  margin-top: 0.4rem;
  font-size: 11px;
  color: var(--color-surface-400, #94a3b8);
  text-align: right;
}

.ud-footer {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.85rem 1.25rem;
  border-top: 1px solid color-mix(in srgb, var(--color-surface-800, #27272a) 70%, transparent);
}

.ud-footer-spacer {
  flex: 1 1 auto;
}

.ud-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.5rem 0.95rem;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
  text-decoration: none;
  white-space: nowrap;
}

.ud-btn-primary {
  background: var(--color-accent-cyan, #22d3ee);
  color: var(--color-surface-950, #0f172a);
}

.ud-btn-primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 85%, white);
}

.ud-btn-primary:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.ud-btn-ghost {
  background: transparent;
  color: var(--color-surface-400, #94a3b8);
  border-color: var(--color-surface-700, #334155);
}

.ud-btn-ghost:hover {
  color: var(--color-surface-100, #f4f4f5);
  border-color: var(--color-surface-600, #475569);
}

.ud-btn-disabled {
  background: var(--color-surface-800, #27272a);
  color: var(--color-surface-500, #64748b);
  cursor: not-allowed;
}

.ud-progress-hint,
.ud-ready-note {
  font-size: 11px;
  color: var(--color-surface-400, #94a3b8);
}

.ud-ready-note {
  color: var(--color-accent-emerald, #10b981);
}

.update-dialog-enter-active,
.update-dialog-leave-active {
  transition: opacity 0.2s ease;
}

.update-dialog-enter-active .ud-dialog,
.update-dialog-leave-active .ud-dialog {
  transition:
    transform 0.25s ease,
    opacity 0.25s ease;
}

.update-dialog-enter-from,
.update-dialog-leave-to {
  opacity: 0;
}

.update-dialog-enter-from .ud-dialog,
.update-dialog-leave-to .ud-dialog {
  transform: translateY(12px) scale(0.98);
  opacity: 0;
}
</style>
