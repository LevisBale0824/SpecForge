// ---------------------------------------------------------------------------
// Auto-updater module
// ---------------------------------------------------------------------------
// Wraps `electron-updater` with:
// - dev-mode guard (skips entirely when running under VITE_DEV_SERVER_URL)
// - persistent autoUpdate / proxy / skippedVersion preferences, mirrored into
//   the shared specforge.config.json (see prefsStore.ts) so they stay
//   consistent across multi-instance launches
// - event broadcast to the renderer via `update:event` IPC channel
// - manual IPC handlers: `update:check`, `update:install`, `update:setAutoCheck`
// ---------------------------------------------------------------------------
import { app, BrowserWindow, ipcMain, session } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { autoUpdater } from "electron-updater";
import { getAllPrefs, setPref } from "./prefsStore";

// ── Types ─────────────────────────────────────────────────────────────────

export type UpdateEvent =
  | { status: "checking" }
  | { status: "available"; version: string; releaseNotes: string }
  | { status: "up-to-date" }
  | {
      status: "progress";
      percent: number;
      bytesPerSecond: number;
      transferred: number;
      total: number;
    }
  | { status: "downloaded"; version: string }
  | { status: "error"; error: string };

export type UserPrefs = {
  autoUpdate: boolean;
  proxy: string;
  skippedVersion: string | null;
};

const DEFAULT_USER_PREFS: UserPrefs = {
  autoUpdate: true,
  proxy: "",
  skippedVersion: null,
};

// ── Persistent user prefs (stored in specforge.config.json) ────────────────
//
// Keys & serialization (prefsStore is Record<string, string>):
//   "update:autoCheck" → "true" | "false"
//   "update:proxy"     → raw proxy string ("" = none)
//
// `skippedVersion` is deliberately NOT persisted. "Skip this version" is a
// session-scoped UX choice ("don't bother me about 0.5.0 right now"), not a
// permanent ban. Restarting the app resets it to null so the user gets
// re-prompted on the next launch — otherwise a one-click "skip" would
// silently prevent them from ever seeing that update again. The value lives
// in `sessionSkippedVersion` below.
//
// Boolean/null are serialized as strings because prefsStore's contract is
// string-only (it also backs the renderer's localStorage hydration, which
// can only hold strings). Conversion lives in this module.

const KEY_AUTO_CHECK = "update:autoCheck";
const KEY_PROXY = "update:proxy";

/** Persisted prefs (autoUpdate + proxy only). */
let cachedPrefs: { autoUpdate: boolean; proxy: string } | null = null;

/** Session-only skip choice. Reset to null on every app launch. */
let sessionSkippedVersion: string | null = null;

let migrated = false;

/**
 * One-shot migration from the legacy standalone file
 * (`userData/user-prefs.json`) into the shared specforge.config.json.
 *
 * Runs when the new keys are absent AND the legacy file still exists.
 * After a successful copy the legacy file is deleted so this is a no-op
 * on subsequent launches.
 *
 * `skippedVersion` is intentionally NOT migrated — the new semantics reset
 * it every launch, so a stale "skip 0.5.0" from the old install shouldn't
 * survive the upgrade.
 */
function migrateFromLegacyPrefs(): void {
  if (migrated) return;
  migrated = true;
  const all = getAllPrefs();
  if (all[KEY_AUTO_CHECK] !== undefined) return; // already in new location
  const legacyPath = path.join(app.getPath("userData"), "user-prefs.json");
  let parsed: Partial<UserPrefs> = {};
  try {
    parsed = JSON.parse(fs.readFileSync(legacyPath, "utf-8")) as Partial<UserPrefs>;
  } catch {
    return; // legacy file missing or corrupt — nothing to migrate
  }
  setPref(KEY_AUTO_CHECK, String(parsed.autoUpdate ?? DEFAULT_USER_PREFS.autoUpdate));
  setPref(KEY_PROXY, typeof parsed.proxy === "string" ? parsed.proxy : "");
  try {
    fs.unlinkSync(legacyPath);
    console.log("[updater] migrated user-prefs.json → specforge.config.json");
  } catch (err) {
    console.warn("[updater] migrated values but failed to remove legacy user-prefs.json:", err);
  }
}

function loadPrefs(): UserPrefs {
  if (!cachedPrefs) {
    migrateFromLegacyPrefs();
    const all = getAllPrefs();
    cachedPrefs = {
      autoUpdate: all[KEY_AUTO_CHECK] !== "false", // default true
      proxy: typeof all[KEY_PROXY] === "string" ? all[KEY_PROXY].trim() : "",
    };
  }
  return { ...cachedPrefs, skippedVersion: sessionSkippedVersion };
}

function savePrefs(next: UserPrefs): void {
  // Only autoUpdate/proxy persist; skippedVersion stays session-only.
  cachedPrefs = { autoUpdate: next.autoUpdate, proxy: next.proxy };
  sessionSkippedVersion = next.skippedVersion;
  setPref(KEY_AUTO_CHECK, String(next.autoUpdate));
  setPref(KEY_PROXY, next.proxy);
}

export function getUserPrefs(): UserPrefs {
  return { ...loadPrefs() };
}

export function setUserPrefs(patch: Partial<UserPrefs>): UserPrefs {
  const merged = { ...loadPrefs(), ...patch };
  savePrefs(merged);
  return merged;
}

// ── Updater lifecycle ─────────────────────────────────────────────────────

let initialized = false;
// Resolvers waiting on the next terminal event from the most recent manual
// `checkForUpdates` call. Cleared on resolve.
let manualResolvers: {
  resolve: (e: UpdateEvent) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
} | null = null;
// True while a manual `update:check` IPC is in flight. Used by the
// `update-available` listener to decide whether to honor `skippedVersion`.
let isManualCheck = false;

function getWindow(): BrowserWindow | null {
  const wins = BrowserWindow.getAllWindows();
  return wins[0] ?? null;
}

function broadcast(event: UpdateEvent): void {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send("update:event", event);
}

function clearManualResolver(): void {
  if (manualResolvers?.timer) clearTimeout(manualResolvers.timer);
  manualResolvers = null;
}

function resolveManual(event: UpdateEvent): void {
  if (!manualResolvers) return;
  manualResolvers.resolve(event);
  clearManualResolver();
}

function rejectManual(err: Error): void {
  if (!manualResolvers) return;
  manualResolvers.reject(err);
  clearManualResolver();
}

/**
 * Normalize a user-typed proxy string into Chromium proxy_rules format.
 *
 * Chromium's proxyRules does NOT accept URL form (no `http://` prefix).
 * Acceptable inputs we want to support:
 *   - "127.0.0.1:7890"            → "127.0.0.1:7890"
 *   - "http://127.0.0.1:7890"     → "127.0.0.1:7890"
 *   - "socks5://127.0.0.1:10808"  → "socks5://127.0.0.1:10808" (kept; valid)
 *   - "http=host:80;https=..."     → pass through (already rules form)
 */
function normalizeProxyRules(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  // Already in rules form (contains '=' or starts with socks)
  if (trimmed.includes("=")) return trimmed;
  // Strip http(s):// prefix, leaving host:port. Chromium applies host:port
  // to all schemes (http/https/ftp).
  return trimmed.replace(/^https?:\/\//i, "");
}

/**
 * Apply the persisted proxy setting to Electron's default session.
 * electron-updater's HTTP requests go through this session, so this is the
 * authoritative place to configure proxying. Safe to call multiple times.
 *
 * Priority: ELECTRON_UPDATER_PROXY env var > specforge.config.json proxy > system default.
 * Empty string clears any previously configured proxy.
 */
async function applyProxy(): Promise<void> {
  const fromEnv = process.env.ELECTRON_UPDATER_PROXY?.trim();
  const raw = (fromEnv || loadPrefs().proxy || "").trim();
  const proxyRules = normalizeProxyRules(raw);
  try {
    await session.defaultSession.setProxy({
      proxyRules: proxyRules || "direct://",
    });
    if (proxyRules) {
      console.log("[updater] proxy applied:", proxyRules);
    }
  } catch (err) {
    console.error("[updater] setProxy failed:", err);
  }
}

/**
 * Initialize auto-updater event wiring. Safe to call once per process.
 * Dev-mode no-op: when `VITE_DEV_SERVER_URL` is set the packaged
 * `app-update.yml` doesn't exist, so any autoUpdater call would throw.
 */
export async function initAutoUpdater(): Promise<void> {
  if (initialized) return;
  if (process.env.VITE_DEV_SERVER_URL) {
    // Dev: still register IPC so renderer calls don't hang, but never touch
    // autoUpdater itself.
    registerIpc();
    initialized = true;
    return;
  }
  initialized = true;

  // Configure proxy before any autoUpdater network call.
  await applyProxy();

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // Differential download tries to fetch only changed blocks via the blockmap,
  // then reconstruct the full installer. For SpecForge (~100MB, code-signed
  // with a fresh timestamp each release) the reconstruction almost always
  // fails the sha512 check and falls back to a full download anyway — which
  // surfaces as a confusing "100% then restart from 0%" UX. Disable it.
  autoUpdater.disableDifferentialDownload = true;
  // GitHub publish is configured in package.json > build.publish; the bundled
  // app-update.yml is generated by electron-builder and read automatically.

  autoUpdater.on("checking-for-update", () => {
    broadcast({ status: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    const version = info?.version ?? "";
    const notes =
      typeof info?.releaseNotes === "string"
        ? info.releaseNotes
        : Array.isArray(info?.releaseNotes)
          ? (info.releaseNotes as Array<{ note: string | null }>)
              .map((r) => r.note ?? "")
              .join("\n")
          : "";
    // Respect "ignore this version" — but only for auto-checks, not manual.
    // Manual checks bypass the skip so users can still see/upgrade a skipped
    // version if they explicitly ask.
    if (!isManualCheck && version && loadPrefs().skippedVersion === version) {
      const event: UpdateEvent = { status: "up-to-date" };
      broadcast(event);
      resolveManual(event);
      return;
    }
    const event: UpdateEvent = {
      status: "available",
      version,
      releaseNotes: notes,
    };
    broadcast(event);
    resolveManual(event);
  });

  autoUpdater.on("update-not-available", () => {
    const event: UpdateEvent = { status: "up-to-date" };
    broadcast(event);
    resolveManual(event);
  });

  autoUpdater.on("download-progress", (p) => {
    broadcast({
      status: "progress",
      percent: Math.round(p.percent ?? 0),
      bytesPerSecond: p.bytesPerSecond ?? 0,
      transferred: p.transferred ?? 0,
      total: p.total ?? 0,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    const event: UpdateEvent = {
      status: "downloaded",
      version: info?.version ?? "",
    };
    broadcast(event);
    // Don't resolve manual here — the user wanted to know "is there an update",
    // which was already answered by `update-available`. Downloaded is a bonus.
  });

  autoUpdater.on("error", (err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[updater] error:", message);
    // Only broadcast errors during manual checks; auto-check failures stay
    // silent to avoid bothering users on flaky networks.
    if (manualResolvers) {
      broadcast({ status: "error", error: message });
      rejectManual(err instanceof Error ? err : new Error(message));
    } else {
      console.warn("[updater] auto-check error (suppressed from UI):", message);
    }
  });

  registerIpc();

  // Kick off the first auto-check if the user hasn't disabled it.
  if (loadPrefs().autoUpdate) {
    // Defer slightly so window/webContents have a chance to be ready; if no
    // window exists yet the broadcast is a no-op and events are simply lost
    // (acceptable for background auto-checks).
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err: unknown) => {
        console.warn("[updater] auto-check failed:", err);
      });
    }, 3000);
  }
}

function registerIpc(): void {
  // Manual check. Resolves with the first terminal event
  // (`available` / `up-to-date` / `error`); autoDownload kicks in on available.
  ipcMain.handle("update:check", async (): Promise<UpdateEvent> => {
    if (process.env.VITE_DEV_SERVER_URL) {
      return { status: "up-to-date" };
    }
    // If a previous manual check is somehow still pending, settle it.
    rejectManual(new Error("superseded by a new manual check"));
    return new Promise<UpdateEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        rejectManual(new Error("update check timed out"));
      }, 30_000);
      manualResolvers = { resolve, reject, timer };
      isManualCheck = true;
      autoUpdater
        .checkForUpdates()
        .catch((err: unknown) => {
          rejectManual(err instanceof Error ? err : new Error(String(err)));
        })
        .finally(() => {
          isManualCheck = false;
        });
    });
  });

  // Current app version (from package.json via Electron's app.getVersion).
  ipcMain.handle("update:getVersion", (): string => app.getVersion());

  // User explicitly chose to download the update. With autoDownload=false,
  // this is the only path that triggers a download.
  ipcMain.handle("update:download", async (): Promise<void> => {
    if (process.env.VITE_DEV_SERVER_URL) return;
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      broadcast({ status: "error", error: msg });
    }
  });

  // Mark a version as skipped so future auto-checks suppress it.
  ipcMain.handle(
    "update:skipVersion",
    (_e, version: string | null): UserPrefs =>
      setUserPrefs({ skippedVersion: typeof version === "string" ? version : null }),
  );

  ipcMain.handle("update:install", async (): Promise<void> => {
    if (process.env.VITE_DEV_SERVER_URL) return;
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle("update:getPrefs", (): UserPrefs => getUserPrefs());

  ipcMain.handle(
    "update:setAutoCheck",
    (_e, enabled: boolean): UserPrefs => setUserPrefs({ autoUpdate: enabled }),
  );

  // Persist proxy URL and apply to the default session immediately so the
  // next checkForUpdates uses it without a restart.
  ipcMain.handle("update:setProxy", async (_e, proxy: string): Promise<UserPrefs> => {
    const next = setUserPrefs({ proxy: typeof proxy === "string" ? proxy.trim() : "" });
    await applyProxy();
    return next;
  });
}
