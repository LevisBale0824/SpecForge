<script setup lang="ts">
// ---------------------------------------------------------------------------
// FileViewer
// ---------------------------------------------------------------------------
// Inline content renderer for a single file. Renders inside a tab container
// (see App.vue) — no modal chrome, no Esc handler, no close button (the tab
// strip owns those). Loads content via `useFileContent.loadFileContent`
// which hits the backend's `/file/content` endpoint with LRU caching so
// switching back to an already-open tab is instant.
// ---------------------------------------------------------------------------

import { computed, ref, watch, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { useFileContent } from "../composables/useFileContent";

const props = defineProps<{
  path: string;
  directory: string;
}>();

const { t } = useI18n();
const { state, loadFileContent } = useFileContent();

// Whether the user has copied the current text content to the clipboard.
// Auto-resets 1.5s after the click so the tooltip can confirm success.
const copied = ref(false);
let copyResetTimer: ReturnType<typeof setTimeout> | null = null;

// Load (or pull from cache) whenever the target path changes.
watch(
  () => [props.directory, props.path] as const,
  ([dir, p]) => {
    if (dir && p) void loadFileContent(dir, p);
  },
  { immediate: true },
);

// Split text content into lines for the line-number gutter. Empty content →
// single empty line so the gutter still has a row to render.
const lines = computed<string[]>(() => {
  if (state.value.status !== "ready") return [];
  const data = state.value.data;
  if (data.kind !== "text") return [];
  if (data.content === "") return [""];
  return data.content.replace(/\r\n/g, "\n").split("\n");
});

// Approximate size label for the footer. For text we use character count;
// for binary we use the byteLength from the response.
const sizeLabel = computed(() => {
  if (state.value.status !== "ready") return "";
  const data = state.value.data;
  if (data.kind === "text") {
    const bytes = new Blob([data.content]).size;
    return formatBytes(bytes);
  }
  return formatBytes(data.byteLength);
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function copyContent() {
  if (state.value.status !== "ready") return;
  const data = state.value.data;
  if (data.kind !== "text") return;
  try {
    await navigator.clipboard.writeText(data.content);
    copied.value = true;
    if (copyResetTimer) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch (error) {
    console.error("[FileViewer] copy failed:", error);
  }
}

onBeforeUnmount(() => {
  if (copyResetTimer) clearTimeout(copyResetTimer);
});
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-surface-950">
    <!-- Toolbar -->
    <div
      class="flex items-center justify-end gap-2 border-b border-surface-800 bg-surface-900 px-3 py-1.5"
    >
      <button
        v-if="state.status === 'ready' && state.data.kind === 'text'"
        type="button"
        class="rounded px-2 py-1 text-xs text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-200"
        :title="t('fileViewer.copy')"
        @click="copyContent"
      >
        {{ copied ? t("fileViewer.copied") : t("fileViewer.copy") }}
      </button>
      <span class="truncate text-xs text-surface-500" :title="props.path">
        {{ props.path }}
      </span>
    </div>

    <!-- Body -->
    <div class="relative flex-1 overflow-auto bg-surface-950">
      <!-- Loading -->
      <div
        v-if="state.status === 'loading' || state.status === 'idle'"
        class="flex h-40 items-center justify-center text-sm text-surface-500"
      >
        {{ t("fileViewer.loading") }}
      </div>

      <!-- Error -->
      <div
        v-else-if="state.status === 'error'"
        class="flex h-40 flex-col items-center justify-center gap-2 px-6 text-center"
      >
        <svg class="h-8 w-8 text-accent-rose" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0L3.16 16.25A2 2 0 005 19z"
          />
        </svg>
        <div class="text-sm text-surface-300">{{ t("fileViewer.error") }}</div>
        <div class="max-w-md text-xs text-surface-500">{{ state.message }}</div>
      </div>

      <!-- Binary -->
      <div
        v-else-if="state.data.kind === 'binary'"
        class="flex h-40 flex-col items-center justify-center gap-2 text-center"
      >
        <svg class="h-8 w-8 text-surface-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <div class="text-sm text-surface-300">{{ t("fileViewer.binary") }}</div>
        <div v-if="sizeLabel" class="text-xs text-surface-500">{{ sizeLabel }}</div>
      </div>

      <!-- Text -->
      <div v-else class="flex min-h-full text-xs leading-5">
        <!-- Line numbers -->
        <pre
          class="sticky left-0 select-none border-r border-surface-800 bg-surface-950 px-3 py-3 text-right font-mono text-surface-600"
          >{{ lines.map((_, i) => i + 1).join("\n") }}</pre
        >
        <!-- Content -->
        <pre class="flex-1 overflow-x-auto px-4 py-3 font-mono text-surface-200">{{
          state.data.content
        }}</pre>
      </div>
    </div>

    <!-- Footer -->
    <div
      v-if="state.status === 'ready'"
      class="flex items-center justify-between border-t border-surface-800 bg-surface-900 px-4 py-1.5 text-[10px] uppercase tracking-wide text-surface-500"
    >
      <span v-if="state.data.kind === 'text'">
        {{ lines.length }} {{ t("fileViewer.lines") }}
      </span>
      <span v-else>{{ t("fileViewer.binary") }}</span>
      <span v-if="sizeLabel">{{ sizeLabel }}</span>
    </div>
  </div>
</template>
