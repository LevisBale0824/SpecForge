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
import { isElectron } from "../utils/electronBridge";

// ── Default URLs ──────────────────────────────────────────────────────────

const DEFAULT_OPENCODE_URL = "http://localhost:13284";
const DEFAULT_ZERO_URL = "http://localhost:13286";
const DEFAULT_CLI_BRIDGE_URL = "http://localhost:13285";

// ── Browser-mode-only localStorage persistence ─────────────────────────────
//
// These keys persist the user's baseUrl/auth override for the BROWSER runtime
// only (where SpecForge connects to a manually-started remote daemon). They
// are deliberately NOT routed through storageSet, so they never end up in
// specforge.config.json:
//
//   - In Electron mode (primary target) the SettingsPanel hides these inputs
//     entirely (`v-if="!backend.isElectron"`) and the main process spawns
//     the daemons on fixed ports (13284/13286). Persisting these values to a
//     shared multi-instance file would just collect dead config.
//   - In Browser mode localStorage alone is sufficient (single tab scope).
//
// The keys keep the `<domain>:<field>` shape for grep grouping but live
// outside StorageKeys to make their "browser-only, never mirrored" status
// explicit.

const BROWSER_KEYS = {
  opencodeUrl: "opencode:baseUrl",
  zeroUrl: "zero:baseUrl",
  opencodeAuth: "opencode:authorization",
  zeroAuth: "zero:authorization",
} as const;

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota — browser-only, non-fatal */
  }
}

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
  const { url, auth } = resolveBackendConfig(kind);
  adapter.configure({ baseUrl: url, authorization: auth });
}

/**
 * Resolve the baseUrl + auth that should be active for the given backend
 * kind in the current runtime. In Electron mode this always returns the
 * hardcoded daemon ports (the main process spawns them) and ignores
 * localStorage entirely — historical pollution in storage can't poison the
 * renderer. In Browser mode it falls back to the persisted values so users
 * can point at a remote daemon.
 */
export function resolveBackendConfig(kind: BackendKind): { url: string; auth: string | undefined } {
  if (isElectron()) {
    const url =
      kind === "zero"
        ? DEFAULT_ZERO_URL
        : kind === "cli-bridge"
          ? DEFAULT_CLI_BRIDGE_URL
          : DEFAULT_OPENCODE_URL;
    return { url, auth: undefined };
  }
  const authKey =
    kind === "opencode"
      ? BROWSER_KEYS.opencodeAuth
      : kind === "zero"
        ? BROWSER_KEYS.zeroAuth
        : null;
  return {
    url: getPersistedUrlFor(kind),
    auth: authKey ? (readLocal(authKey) ?? undefined) : undefined,
  };
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
//
// Each configure* call does two things:
//   1. Forwards to the adapter (updates the shared REST client).
//   2. In Browser mode, mirrors the value into localStorage so the override
//      survives reloads. Electron mode skips the mirror — the main process
//      owns daemon ports and the UI doesn't expose these inputs.

export function configureOpenCodeBackend(options: { baseUrl?: string; authorization?: string }) {
  getBackendAdapter("opencode").configure?.(options);
  if (!isElectron()) {
    if (options.baseUrl !== undefined) writeLocal(BROWSER_KEYS.opencodeUrl, options.baseUrl);
    if (options.authorization !== undefined)
      writeLocal(BROWSER_KEYS.opencodeAuth, options.authorization);
  }
}

export function configureZeroBackend(options: { baseUrl?: string; authorization?: string }) {
  getBackendAdapter("zero").configure?.(options);
  if (!isElectron()) {
    if (options.baseUrl !== undefined) writeLocal(BROWSER_KEYS.zeroUrl, options.baseUrl);
    if (options.authorization !== undefined)
      writeLocal(BROWSER_KEYS.zeroAuth, options.authorization);
  }
}

export function getPersistedOpenCodeUrl(): string {
  return readLocal(BROWSER_KEYS.opencodeUrl) ?? DEFAULT_OPENCODE_URL;
}

export function getPersistedZeroUrl(): string {
  return readLocal(BROWSER_KEYS.zeroUrl) ?? DEFAULT_ZERO_URL;
}

export function getPersistedCliBridgeUrl(): string {
  // cli-bridge has no UI to override its URL — always the default.
  return DEFAULT_CLI_BRIDGE_URL;
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
    const persistedAuth = readLocal(BROWSER_KEYS.opencodeAuth);
    oc.configure?.({
      baseUrl: persistedUrl,
      authorization: persistedAuth ?? undefined,
    });
    adapters = { ...adapters, opencode: oc };
  }
  if (!adapters["zero"]) {
    const z = createZeroAdapter();
    const persistedUrl = getPersistedZeroUrl();
    const persistedAuth = readLocal(BROWSER_KEYS.zeroAuth);
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
