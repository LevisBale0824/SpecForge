// ---------------------------------------------------------------------------
// Backend Adapter Registry
// ---------------------------------------------------------------------------
// Module-level singleton registry that manages the active backend adapter.
// UI code calls getActiveBackendAdapter() to access the current backend.
// Ported from opencode-visualizer-cn/app/backends/registry.ts
// ---------------------------------------------------------------------------

import { createOpenCodeAdapter } from "./openCodeAdapter";
import { createZeroAdapter } from "./zeroAdapter";
import type { BackendAdapter, BackendKind } from "./types";
import { StorageKeys, storageGet, storageRemove } from "../utils/storageKeys";

// ── Default URLs ──────────────────────────────────────────────────────────

const DEFAULT_OPENCODE_URL = "http://localhost:13284";
const DEFAULT_ZERO_URL = "http://localhost:13286";
const DEFAULT_CLI_BRIDGE_URL = "http://localhost:13285";

// ── Adapter instances ────────────────────────────────────────────────────

let adapters: Partial<Record<BackendKind, BackendAdapter>> = {};

// Active backend kind is intentionally NOT persisted across launches. Every
// app boot starts as "opencode" (the safe default — matches the main process
// spawn). If the user previously switched to an agent whose CLI isn't
// installed, persisting that choice would brick every subsequent launch.
// Switching during a session updates this in-memory value only.
let activeBackendKind: BackendKind = "opencode";

const listeners = new Set<(kind: BackendKind) => void>();

// ── Public API ────────────────────────────────────────────────────────────

export function getActiveBackendKind(): BackendKind {
  return activeBackendKind;
}

export function setActiveBackendKind(kind: BackendKind) {
  if (!adapters[kind]) {
    throw new Error(`Backend adapter is not registered: ${kind}`);
  }
  activeBackendKind = kind;
  // Re-apply the freshly-activated backend's persisted config to the shared
  // REST client. Both opencode and zero adapters reuse `app/utils/opencode.ts`,
  // which keeps baseUrl/auth in module-level variables. ensureAdapters()
  // configures opencode first and zero second — so by the time it returns the
  // shared client is left pointing at zero's :13286 regardless of which
  // backend is actually active. Without this re-apply, every boot defaults to
  // 13286 and every kind switch needs the caller to also reconfigure, which
  // is easy to forget (and was forgotten on the initial boot path).
  applyPersistedConfig(kind);
  for (const listener of listeners) listener(kind);
}

function applyPersistedConfig(kind: BackendKind): void {
  const adapter = adapters[kind];
  if (!adapter?.configure) return;
  const persistedUrl = getPersistedUrlFor(kind);
  const authKey =
    kind === "opencode"
      ? StorageKeys.auth.opencodeAuthorization
      : kind === "zero"
        ? StorageKeys.auth.zeroAuthorization
        : null;
  const persistedAuth = authKey ? (storageGet(authKey) ?? undefined) : undefined;
  adapter.configure({ baseUrl: persistedUrl, authorization: persistedAuth });
}

export function onActiveBackendKindChange(listener: (kind: BackendKind) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function registerAdapter(adapter: BackendAdapter) {
  adapters = { ...adapters, [adapter.kind]: adapter };
}

export function getBackendAdapter(kind: BackendKind): BackendAdapter {
  const adapter = adapters[kind];
  if (!adapter) {
    throw new Error(`Backend adapter is not registered: ${kind}`);
  }
  return adapter;
}

export function getActiveBackendAdapter(): BackendAdapter {
  return getBackendAdapter(activeBackendKind);
}

// ── Configure helpers ────────────────────────────────────────────────────

export function configureOpenCodeBackend(options: { baseUrl?: string; authorization?: string }) {
  getBackendAdapter("opencode").configure?.(options);
}

export function configureZeroBackend(options: { baseUrl?: string; authorization?: string }) {
  getBackendAdapter("zero").configure?.(options);
}

export function getPersistedOpenCodeUrl(): string {
  return storageGet(StorageKeys.auth.opencodeBaseUrl) ?? DEFAULT_OPENCODE_URL;
}

export function getPersistedZeroUrl(): string {
  return storageGet(StorageKeys.auth.zeroBaseUrl) ?? DEFAULT_ZERO_URL;
}

export function getPersistedCliBridgeUrl(): string {
  return storageGet(StorageKeys.auth.cliBridgeUrl) ?? DEFAULT_CLI_BRIDGE_URL;
}

/** Returns the persisted baseURL for the given backend kind. */
export function getPersistedUrlFor(kind: BackendKind): string {
  switch (kind) {
    case "opencode":
      return getPersistedOpenCodeUrl();
    case "zero":
      return getPersistedZeroUrl();
    case "cli-bridge":
      return getPersistedCliBridgeUrl();
  }
}

// ── Lazy init ────────────────────────────────────────────────────────────

function ensureAdapters() {
  if (!adapters["opencode"]) {
    const oc = createOpenCodeAdapter();
    const persistedUrl = getPersistedOpenCodeUrl();
    const persistedAuth = storageGet(StorageKeys.auth.opencodeAuthorization);
    oc.configure?.({
      baseUrl: persistedUrl,
      authorization: persistedAuth ?? undefined,
    });
    adapters = { ...adapters, opencode: oc };
  }
  if (!adapters["zero"]) {
    const z = createZeroAdapter();
    const persistedUrl = getPersistedZeroUrl();
    const persistedAuth = storageGet(StorageKeys.auth.zeroAuthorization);
    z.configure?.({
      baseUrl: persistedUrl,
      authorization: persistedAuth ?? undefined,
    });
    adapters = { ...adapters, zero: z };
  }
}

// Initialise on import
ensureAdapters();
// After ensureAdapters the shared REST client is left configured for whatever
// adapter was created last (zero), not for the actual active backend. Re-apply
// the active kind's config so the initial boot talks to the right port.
applyPersistedConfig(activeBackendKind);

// One-shot migration: earlier versions persisted the active backend kind to
// localStorage. We no longer read or write it (kind is in-session only — see
// activeBackendKind above), but stale values from older installs may still be
// present. Remove it so it doesn't confuse future debugging.
storageRemove(StorageKeys.auth.activeBackend);
