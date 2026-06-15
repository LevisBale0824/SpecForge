// ---------------------------------------------------------------------------
// Commands Store
// ---------------------------------------------------------------------------
// Caches the list of available slash commands for the active backend/directory.
// Loaded lazily when the user first types "/" in the input panel, and reloaded
// when the backend or project directory changes.
// ---------------------------------------------------------------------------

import { ref } from "vue";
import type { BackendAdapter } from "../backends/types";
import type { CommandInfo } from "../types/command";

const commands = ref<CommandInfo[]>([]);
const loaded = ref(false);
const loading = ref(false);

async function loadCommands(
  adapter: BackendAdapter | undefined,
  directory?: string,
): Promise<void> {
  if (!adapter?.listCommands) {
    commands.value = [];
    loaded.value = true;
    return;
  }
  if (loading.value) return;
  loading.value = true;
  try {
    const result = await adapter.listCommands(directory);
    commands.value = Array.isArray(result) ? (result as CommandInfo[]) : [];
    loaded.value = true;
  } catch (error) {
    // IMPORTANT: do NOT flip `loaded` on error. ensureLoaded() guards on
    // loaded/loading, so marking it true here would suppress every retry —
    // the menu would never recover after a transient failure (common during
    // dev startup when the backend isn't up yet on the first "/" press).
    console.error("[useCommands] loadCommands failed:", error);
    commands.value = [];
  } finally {
    loading.value = false;
  }
}

/** Load on first demand. Safe to call repeatedly — no-ops if already loaded. */
function ensureLoaded(adapter: BackendAdapter | undefined, directory?: string): void {
  if (loaded.value || loading.value) return;
  void loadCommands(adapter, directory);
}

/** Force reload (used when backend or directory changes). */
async function reloadCommands(
  adapter: BackendAdapter | undefined,
  directory?: string,
): Promise<void> {
  loaded.value = false;
  await loadCommands(adapter, directory);
}

function reset(): void {
  commands.value = [];
  loaded.value = false;
  loading.value = false;
}

export function useCommands() {
  return {
    commands,
    loaded,
    loading,
    loadCommands,
    ensureLoaded,
    reloadCommands,
    reset,
  };
}
