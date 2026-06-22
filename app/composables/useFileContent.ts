// ---------------------------------------------------------------------------
// File Content Cache
// ---------------------------------------------------------------------------
// Wraps `adapter.readFileContent({directory, path})` with a small in-memory
// cache so re-opening a file in the viewer is instant. Cache is keyed by
// `${directory}::${path}` and cleared on backend switch.
//
// The opencode /file/content endpoint returns `{type:"text"|"binary", content}`
// for text files and bytes for binary. We normalize both shapes into a
// `FileContent` discriminated union that the viewer can switch on.
// ---------------------------------------------------------------------------

import { ref } from "vue";
import { getActiveBackendAdapter } from "../backends/registry";

export type FileContent =
  | { kind: "text"; content: string }
  | { kind: "binary"; byteLength: number };

export type FileContentState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: FileContent };

type CacheEntry = FileContent;

const cache = new Map<string, CacheEntry>();
// Bounded LRU — keep the most recent 32 file reads. The viewer is the only
// consumer; opening a 33rd distinct file evicts the oldest entry.
const CACHE_MAX = 32;

const state = ref<FileContentState>({ status: "idle" });

function cacheKey(directory: string, path: string): string {
  return `${directory}::${path}`;
}

function touchCache(key: string, entry: CacheEntry): void {
  if (cache.size >= CACHE_MAX) {
    // Map iterates in insertion order — delete the first key to evict oldest.
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, entry);
}

function normalize(raw: unknown): FileContent {
  // opencode shape: {type:"text", content:"..."} | {type:"binary", ...}
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (r.type === "text" && typeof r.content === "string") {
      return { kind: "text", content: r.content };
    }
    if (r.type === "binary") {
      const bytes = r.content;
      const byteLength =
        typeof bytes === "string"
          ? bytes.length
          : Array.isArray(bytes) || bytes instanceof Uint8Array
            ? bytes.length
            : 0;
      return { kind: "binary", byteLength };
    }
    // Fallback: if it's a bare string, treat as text.
    if (typeof r.content === "string") {
      return { kind: "text", content: r.content };
    }
  }
  if (typeof raw === "string") {
    return { kind: "text", content: raw };
  }
  // Unknown shape — surface as binary so the viewer shows a graceful message.
  return { kind: "binary", byteLength: 0 };
}

async function loadFileContent(directory: string, path: string): Promise<void> {
  if (!directory || !path) {
    state.value = { status: "error", message: "Missing directory or path" };
    return;
  }

  const key = cacheKey(directory, path);
  const cached = cache.get(key);
  if (cached) {
    // Refresh insertion order for LRU.
    cache.delete(key);
    cache.set(key, cached);
    state.value = { status: "ready", data: cached };
    return;
  }

  state.value = { status: "loading" };
  try {
    const adapter = getActiveBackendAdapter();
    if (!adapter.readFileContent) {
      throw new Error("Backend does not support reading file content");
    }
    const raw = await adapter.readFileContent({ directory, path });
    const normalized = normalize(raw);
    touchCache(key, normalized);
    state.value = { status: "ready", data: normalized };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[useFileContent] loadFileContent failed:", error);
    state.value = { status: "error", message };
  }
}

function resetFileContentCache(): void {
  cache.clear();
  state.value = { status: "idle" };
}

export function useFileContent() {
  return {
    state,
    loadFileContent,
    resetFileContentCache,
  };
}
