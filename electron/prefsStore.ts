// ---------------------------------------------------------------------------
// prefsStore: persistent shared preferences for multi-instance consistency.
//
// Why this exists: localStorage lives in the renderer and is shared across
// instances only via Chromium's on-disk Local Storage file. Concurrent
// multi-instance access races on that file (async flush + per-renderer
// in-memory cache), and a cache wipe silently loses config. By mirroring
// every persisted key into a main-process JSON file we get:
//
//   - deterministic startup state for every instance
//   - atomic writes (tmp + rename) so partial reads never happen
//   - last-writer-wins semantics, adequate for Phase 1 (startup consistency)
//
// File: userData/specforge/specforge.config.json (see paths.ts).
//
// Layout: a flat map keyed by the same identifier used by
// `app/utils/storageKeys.ts` — e.g. { "ui:theme": "midnight" }.
// Storing the full key (rather than a nested object) means the renderer
// can hydrate via a single Object.entries loop with zero key-mapping logic.
//
// This module is deliberately synchronous: main-process state must be
// readable the instant a renderer's first IPC call lands, and a single
// small JSON file costs nothing to load at boot. Writes use the atomic
// tmp+rename idiom so other instances reading the file mid-write never
// observe truncated JSON.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import { getPrefsPath } from "./paths";

export type PrefsMap = Record<string, string>;

let cache: PrefsMap | null = null;

/**
 * Load specforge.config.json into the in-memory cache. Must be called once after
 * `initPaths()` (typically from `app.whenReady()`). Safe to call multiple
 * times — only the first call actually reads the file.
 */
export function loadPrefs(): void {
  if (cache !== null) return;

  const prefsPath = getPrefsPath();
  let parsed: PrefsMap = {};
  try {
    const raw = fs.readFileSync(prefsPath, "utf-8");
    const data = JSON.parse(raw);
    if (data && typeof data === "object" && !Array.isArray(data)) {
      // Coerce all values to strings — renderer writes strings, defensive.
      parsed = {};
      for (const [k, v] of Object.entries(data)) {
        if (typeof k === "string") parsed[k] = typeof v === "string" ? v : String(v);
      }
    }
  } catch (err) {
    // Missing file (first launch) → empty prefs. Corrupt JSON → warn + reset.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn("[prefsStore] failed to read specforge.config.json, starting empty:", err);
    }
    parsed = {};
  }
  cache = parsed;
}

/** Return the current prefs map. Triggers loadPrefs() if not yet loaded. */
export function getAllPrefs(): PrefsMap {
  if (cache === null) loadPrefs();
  return { ...cache! };
}

/**
 * Update a single key and persist atomically. Fire-and-forget from the
 * renderer's POV — the IPC handler awaits this, but the renderer doesn't
 * await the IPC. Atomic write via tmp+rename prevents partial reads by
 * other instances.
 */
export function setPref(key: string, value: string): void {
  if (cache === null) loadPrefs();
  cache![key] = value;
  persist();
}

function persist(): void {
  const prefsPath = getPrefsPath();
  const tmpPath = `${prefsPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(cache), "utf-8");
    fs.renameSync(tmpPath, prefsPath);
  } catch (err) {
    console.warn("[prefsStore] failed to persist specforge.config.json:", err);
    // Best-effort cleanup of stale tmp file.
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  }
}
