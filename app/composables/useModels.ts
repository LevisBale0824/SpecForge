// ---------------------------------------------------------------------------
// Models Store
// ---------------------------------------------------------------------------
// Reactive cache of backend providers + their models. Fed by
// `adapter.listProviders()`. Exposes `flatModels` — a convenience list of
// models whose provider is currently "connected", suitable for driving a
// model picker dropdown.
//
// Reset on backend switch or disconnect; refreshed when the connection
// becomes "ready" (see useBackend.ts wiring).
// ---------------------------------------------------------------------------

import { computed, ref } from "vue";
import { getActiveBackendAdapter } from "../backends/registry";
import type {
  BackendProviderInfo,
  BackendProviderModel,
  BackendProviderResponse,
} from "../types/backend-domain";

export type AvailableModel = {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  capabilities?: BackendProviderModel["capabilities"];
  limit?: BackendProviderModel["limit"];
};

const providers = ref<BackendProviderInfo[]>([]);
const connectedProviderIds = ref<ReadonlySet<string>>(new Set());
// Default model per provider, keyed by providerID. May be undefined.
const defaultModelPerProvider = ref<Record<string, string>>({});

const flatModels = computed<AvailableModel[]>(() => {
  const connected = connectedProviderIds.value;
  if (connected.size === 0) return [];
  const out: AvailableModel[] = [];
  for (const provider of providers.value) {
    if (!provider?.id || !connected.has(provider.id)) continue;
    const providerName = provider.name || provider.id;
    const models = provider.models;
    if (!models) continue;
    for (const modelId of Object.keys(models)) {
      const m = models[modelId];
      if (!m) continue;
      out.push({
        id: m.id || modelId,
        name: m.name || m.id || modelId,
        providerId: provider.id,
        providerName,
        capabilities: m.capabilities,
        limit: m.limit,
      });
    }
  }
  return out;
});

function applyResponse(resp: BackendProviderResponse | null | undefined): void {
  if (!resp) {
    providers.value = [];
    connectedProviderIds.value = new Set();
    defaultModelPerProvider.value = {};
    return;
  }
  providers.value = Array.isArray(resp.all) ? resp.all : [];
  connectedProviderIds.value = new Set(Array.isArray(resp.connected) ? resp.connected : []);
  defaultModelPerProvider.value = resp.default ?? {};
}

async function refreshModels(): Promise<void> {
  try {
    const adapter = getActiveBackendAdapter();
    if (!adapter.listProviders) return;
    const result = (await adapter.listProviders()) as BackendProviderResponse | undefined;
    applyResponse(result ?? null);
  } catch (error) {
    console.error("[useModels] refreshModels failed:", error);
  }
}

function resetModels(): void {
  applyResponse(null);
}

export function useModels() {
  return {
    providers,
    connectedProviderIds,
    defaultModelPerProvider,
    flatModels,
    refreshModels,
    resetModels,
  };
}
