// ---------------------------------------------------------------------------
// paths: centralized filesystem layout for SpecForge-managed state.
//
// Two roots:
//
//   1. CONFIG DIR — long-lived, persistent, user-visible configuration &
//      data. Survives reboots, included in user backups.
//         Windows: %APPDATA%/SpecForge/
//         macOS:   ~/Library/Application Support/SpecForge/
//         Linux:   $XDG_CONFIG_HOME/SpecForge/ (~/.config/SpecForge/)
//
//   2. RUNTIME DIR — short-lived, process-bound, machine-local. PID files,
//      locks, sockets. Cleaned by the OS on reboot or user logout.
//         Windows: %TEMP%/specforge-{UID}/
//         macOS:   $TMPDIR/specforge-{UID}/  (fallback /tmp/)
//         Linux:   $XDG_RUNTIME_DIR/specforge/  (systemd /run/user/$UID)
//                  fallback /tmp/specforge-{UID}/
//
// Why split: instances/{pid}.json is pure runtime — the file is meaningless
// once the owning process exits. Putting it in XDG_RUNTIME_DIR on Linux is
// the XDG-compliant convention; on Windows/macOS the TEMP dir serves the
// same role. Persistent state (prefs, agent server PID history) stays in
// the config dir so it survives reboots.
//
// All SpecForge-owned files live under `specforge/` subdirectories to keep
// them visually separated from Chromium-managed files (Cache/, Local
// Storage/, etc.) that Electron writes directly into userData.
// ---------------------------------------------------------------------------

import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { app } from "electron";

let initialized = false;
let configRoot = "";
let runtimeRoot = "";

/** Ensure a directory exists, creating parents as needed. Lazy init. */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Compute the two roots. Must be called after `app.whenReady()` (uses
 * `app.getPath("userData")`). Idempotent — repeated calls return the same
 * paths without re-creating directories.
 */
export function initPaths(): void {
  if (initialized) return;
  initialized = true;

  // ── Config root ──────────────────────────────────────────────────────
  // userData already points to the OS-appropriate per-user app data dir.
  // We nest everything SpecForge owns under `specforge/` to keep it
  // visually separated from Chromium's files in the same parent.
  configRoot = path.join(app.getPath("userData"), "specforge");
  ensureDir(configRoot);
  ensureDir(path.join(configRoot, "agent"));

  // ── Runtime root ─────────────────────────────────────────────────────
  runtimeRoot = computeRuntimeRoot();
  ensureDir(runtimeRoot);
  ensureDir(path.join(runtimeRoot, "instances"));
}

/**
 * Linux: prefer $XDG_RUNTIME_DIR (typically /run/user/$UID, tmpfs, auto-
 * cleaned by systemd on logout). Otherwise fall back to /tmp with a
 * per-UID subdir to avoid collisions between users on the same machine.
 *
 * Windows: %TEMP% / %TMP% already resolves to a per-user directory
 * (C:\Users\<user>\AppData\Local\Temp\), so no UID suffix is needed.
 * Note: os.userInfo().uid returns -1 on Windows (POSIX uid is meaningless
 * there), so we must NOT use it in the path.
 *
 * macOS: $TMPDIR or /tmp. Single-user machines, no UID suffix needed.
 */
function computeRuntimeRoot(): string {
  if (process.platform === "linux") {
    const xdg = process.env.XDG_RUNTIME_DIR;
    if (xdg) return path.join(xdg, "specforge");
    // No systemd / no XDG_RUNTIME_DIR — fallback to /tmp with UID isolation.
    const uid = process.getuid?.() ?? 0;
    return path.join(os.tmpdir(), `specforge-${uid}`);
  }
  // Windows (TEMP is already per-user) and macOS (TMPDIR is per-user).
  return path.join(app.getPath("temp"), "specforge");
}

/** Long-lived config dir: userData/specforge/. */
export function getConfigDir(): string {
  if (!initialized) initPaths();
  return configRoot;
}

/** Short-lived runtime dir: TEMP/specforge-{UID}/ or XDG_RUNTIME_DIR. */
export function getRuntimeDir(): string {
  if (!initialized) initPaths();
  return runtimeRoot;
}

/** Instance registry directory (PID files). Always runtime-scoped. */
export function getInstancesDir(): string {
  return path.join(getRuntimeDir(), "instances");
}

/** Agent server state directory (persistent). */
export function getAgentDir(): string {
  return path.join(getConfigDir(), "agent");
}

/** UI preferences file (persistent). */
export function getPrefsPath(): string {
  return path.join(getConfigDir(), "specforge.config.json");
}

/** Updater ID file (persistent). */
export function getUpdaterIdPath(): string {
  return path.join(getConfigDir(), "updater-id");
}

/** Agent server PID history (persistent, used for zombie cleanup). */
export function getServerPidsPath(): string {
  return path.join(getAgentDir(), "server-pids.json");
}
