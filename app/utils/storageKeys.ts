// ---------------------------------------------------------------------------
// localStorage key helpers
// ---------------------------------------------------------------------------
//
// Persistence model:
//
//   - localStorage remains the synchronous read source for the renderer.
//   - On Electron, every persisted UI key is mirrored to a main-process
//     `specforge.config.json` (see electron/prefsStore.ts) so multiple
//     SpecForge instances see a consistent state across launches.
//     localStorage's async flush + per-renderer cache would otherwise race
//     in multi-instance setups.
//   - hydratePrefsFromMain() runs ONCE at boot, BEFORE any module that
//     reads localStorage at import time (see app/main.ts). It overwrites
//     localStorage entries from specforge.config.json. Missing keys are
//     left alone (first-launch / fresh file preserves existing localStorage).
//   - storageSet() writes localStorage synchronously AND fire-and-forgets
//     a mirror write to the main process. Browser mode falls back to
//     localStorage-only.
//
// Scope: ONLY UI preferences belong here. Backend connection overrides
// (opencode/zero baseUrl + auth) are Browser-mode-only and live in
// `app/backends/registry.ts` (BROWSER_KEYS) — they never mirror into
// specforge.config.json because Electron mode hides those inputs entirely
// and the main process owns daemon ports.
//
// Key format: keys keep their inner ":" segmentation
// (e.g. "ui:locale", "ui:theme") to stay grouped & greppable.
// ---------------------------------------------------------------------------

export const StorageKeys = {
  ui: {
    locale: "ui:locale",
    theme: "ui:theme",
    followSystemTheme: "ui:followSystemTheme",
  },
} as const;

export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore quota errors
  }
  // Mirror to the main-process specforge.config.json for multi-instance consistency.
  // Fire-and-forget: callers expect synchronous semantics. The IPC handler
  // does the actual atomic write on the main side.
  window.electronAPI?.prefsSet?.(key, value);
}

/**
 * Pull the shared prefs map from the main process and overwrite matching
 * localStorage entries. Called ONCE before any module that reads
 * localStorage at import time (useTheme, i18n).
 *
 * - Electron: hydrates from specforge.config.json. Missing keys are preserved.
 * - Browser / no electronAPI: no-op.
 */
export async function hydratePrefsFromMain(): Promise<void> {
  const api = window.electronAPI;
  if (!api?.prefsGetAll) return;
  let prefs: Record<string, string> = {};
  try {
    prefs = (await api.prefsGetAll()) as Record<string, string>;
  } catch {
    return;
  }
  for (const [k, v] of Object.entries(prefs)) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* quota — skip */
    }
  }
}
