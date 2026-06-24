// ---------------------------------------------------------------------------
// useUpdate — renderer-side reactive state for the auto-updater
// ---------------------------------------------------------------------------
// Module-level singleton (same pattern as useAgents). Subscribes to
// `update:event` broadcasts on first import (in Electron mode) and exposes:
// - reactive `state` (status / version / percent / error / lastCheckedAt)
// - `autoUpdate` preference (persisted via main process)
// - actions: checkForUpdates(), installUpdate(), setAutoUpdate()
// In browser mode everything is a no-op; UI can still be mounted safely.
// ---------------------------------------------------------------------------

import { ref } from "vue";
import type { UpdateEvent } from "../types/electron";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "progress"
  | "downloaded"
  | "error";

const state = ref<{
  status: UpdateStatus;
  version: string;
  percent: number;
  error: string;
  lastCheckedAt: number;
}>({
  status: "idle",
  version: "",
  percent: 0,
  error: "",
  lastCheckedAt: 0,
});

const autoUpdate = ref(true);
let subscribed = false;

function applyEvent(event: UpdateEvent): void {
  switch (event.status) {
    case "checking":
      state.value.status = "checking";
      break;
    case "available":
      state.value.status = "available";
      state.value.version = event.version;
      state.value.lastCheckedAt = Date.now();
      break;
    case "up-to-date":
      state.value.status = "up-to-date";
      state.value.lastCheckedAt = Date.now();
      break;
    case "progress":
      state.value.status = "progress";
      state.value.percent = event.percent;
      break;
    case "downloaded":
      state.value.status = "downloaded";
      state.value.version = event.version;
      break;
    case "error":
      state.value.status = "error";
      state.value.error = event.error;
      state.value.lastCheckedAt = Date.now();
      break;
  }
}

async function ensureSubscribed(): Promise<void> {
  if (subscribed) return;
  const api = window.electronAPI;
  if (!api) return;
  subscribed = true;
  api.onUpdateEvent(applyEvent);
  try {
    const prefs = await api.getUpdatePrefs();
    autoUpdate.value = prefs.autoUpdate;
  } catch (err) {
    console.error("[useUpdate] getUpdatePrefs failed:", err);
  }
}

/**
 * Manual check. Returns the first terminal event so callers can show
 * "up-to-date" / "error" toasts. Auto-check failures are silent server-side.
 */
async function checkForUpdates(): Promise<UpdateEvent | null> {
  const api = window.electronAPI;
  if (!api) return null;
  state.value.status = "checking";
  state.value.error = "";
  try {
    const result = await api.checkForUpdates();
    applyEvent(result);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    state.value.status = "error";
    state.value.error = message;
    return { status: "error", error: message };
  }
}

async function installUpdate(): Promise<void> {
  const api = window.electronAPI;
  if (!api) return;
  await api.installUpdate();
}

async function setAutoUpdate(enabled: boolean): Promise<void> {
  const api = window.electronAPI;
  if (!api) return;
  autoUpdate.value = enabled;
  try {
    const prefs = await api.setUpdateAutoCheck(enabled);
    autoUpdate.value = prefs.autoUpdate;
  } catch (err) {
    console.error("[useUpdate] setUpdateAutoCheck failed:", err);
    // Roll back optimistic update on failure
    autoUpdate.value = !enabled;
  }
}

export function useUpdate() {
  // Subscribe on first use. Safe to call repeatedly; ensureSubscribed guards.
  void ensureSubscribed();
  return {
    state,
    autoUpdate,
    checkForUpdates,
    installUpdate,
    setAutoUpdate,
  };
}
