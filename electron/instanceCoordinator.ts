// ---------------------------------------------------------------------------
// instanceCoordinator: lightweight multi-instance awareness.
//
// Replaces the old TCP-based instanceRegistry. No protocol, no heartbeats,
// no primary/secondary roles — just a directory of PID files. The only
// question we ever need to answer is "am I the last SpecForge instance?"
// so the close flow can decide whether to stop the shared agent daemon.
//
// Layout (see paths.ts):
//   {runtimeDir}/instances/{pid}.json
//      { pid: number, startedAt: number, version: string }
//
// Lifecycle:
//   - On launch: sweep orphaned files, then write our own PID file.
//   - On quit: delete our own PID file.
//   - On close: scan the directory, check each other PID. If none are
//     alive SpecForge processes → we're the last.
//
// Stale-file safety: every liveness check (both the launch sweep and the
// close scan) cross-references a full-system PID→exe-name snapshot, so a
// recycled PID reassigned to an unrelated program is never mistaken for a
// live sibling. Files we can't classify (corrupt JSON, snapshot failure)
// are left untouched.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { getInstancesDir } from "./paths";

interface InstanceEntry {
  pid: number;
  startedAt: number;
  version?: string;
}

let myEntry: InstanceEntry | null = null;

/** Basename of our own executable, used to identify sibling SpecForge
 *  processes. In production this is "SpecForge" (Win .exe / macOS app
 *  binary / Linux AppImage); in dev it's "electron" or "node". Matching
 *  on this rather than a hardcoded string keeps dev multi-window and
 *  production parity. */
function ownExeBaseName(): string {
  return path.basename(process.execPath).replace(/\.[^.]+$/, "");
}

/**
 * Snapshot every running PID → executable basename. Rejects PID-reuse
 * false positives: a stale {pid}.json can have its PID recycled into an
 * unrelated process (e.g. steamwebhelper.exe), which process.kill(pid,0)
 * would still call "alive". Null when the snapshot fails — callers then
 * fall back to PID-existence only.
 */
function snapshotProcessNames(): Map<number, string> | null {
  const map = new Map<number, string>();
  try {
    if (process.platform === "win32") {
      // One tasklist call for the whole system — cheaper than per-PID
      // queries and avoids N process spawns.
      const out = execSync(`tasklist /FO CSV /NH`, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      for (const line of out.split(/\r?\n/)) {
        // "SpecForge.exe","41900","Console","1","157,400 K"
        const m = /^"([^"]+)","(\d+)"/.exec(line);
        if (m) map.set(parseInt(m[2], 10), m[1]);
      }
    } else {
      const out = execSync(`ps -A -o pid=,comm=`, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      for (const line of out.split(/\r?\n/)) {
        const m = /^\s*(\d+)\s+(.+)$/.exec(line);
        if (m) map.set(parseInt(m[1], 10), path.basename(m[2].trim()));
      }
    }
    return map;
  } catch {
    return null;
  }
}

/** Test whether a PID is alive across platforms. No signal sent. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ESRCH = no such process. EINVAL = signal 0 not supported (impossible).
    // EPERM = exists but we can't signal it — still "alive" from our POV.
    return code === "EPERM";
  }
}

/**
 * Is the given PID both alive AND a process whose executable matches ours?
 * Falls back to PID-existence-only when pidNameMap is null.
 */
function isOwnInstanceAlive(pid: number, pidNameMap: Map<number, string> | null): boolean {
  if (!isPidAlive(pid)) return false;
  if (pidNameMap === null) return true; // can't verify identity — trust liveness
  const name = pidNameMap.get(pid);
  if (!name) return false;
  return (
    path
      .basename(name)
      .replace(/\.[^.]+$/, "")
      .toLowerCase() === ownExeBaseName().toLowerCase()
  );
}

/** Read & parse a single instance file. Returns null on any error. */
function readEntry(filePath: string): InstanceEntry | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.pid === "number" && typeof parsed?.startedAt === "number") {
      return parsed as InstanceEntry;
    }
  } catch {
    // corrupt or mid-write file — treat as unreadable
  }
  return null;
}

/**
 * Register this instance by writing {pid}.json into the runtime dir.
 *
 * Must be called after `initPaths()` (paths.ts) — typically from
 * `app.whenReady()`.
 */
/**
 * Remove PID files whose owning process is gone, or whose PID was recycled
 * into a non-SpecForge program. Called once at launch before registering
 * ourselves. Safe against concurrent launches: we only delete files we can
 * PROVE are not a live SpecForge (PID dead OR exe-name mismatch). Corrupt
 * files and live siblings are left untouched, so there is no race where one
 * instance's sweep clobbers another's just-written PID file.
 */
function sweepStaleInstances(): void {
  const dir = getInstancesDir();
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return;
  }
  const pidNameMap = snapshotProcessNames();
  let removed = 0;
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const entry = readEntry(path.join(dir, file));
    if (!entry) continue;
    if (entry.pid === process.pid) continue;
    if (isOwnInstanceAlive(entry.pid, pidNameMap)) continue;
    try {
      fs.unlinkSync(path.join(dir, file));
      removed++;
    } catch {
      /* already gone */
    }
  }
  if (removed > 0) {
    console.log(`[instanceCoordinator] swept ${removed} stale instance file(s)`);
  }
}

export function registerInstance(version?: string): void {
  if (myEntry) return;
  sweepStaleInstances();
  myEntry = {
    pid: process.pid,
    startedAt: Date.now(),
    version,
  };
  const filePath = path.join(getInstancesDir(), `${process.pid}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(myEntry), "utf-8");
    console.log(`[instanceCoordinator] registered pid=${process.pid} → ${filePath}`);
  } catch (err) {
    console.warn("[instanceCoordinator] failed to write PID file:", err);
    myEntry = null;
  }
}

/**
 * Delete our PID file. Called during quit. Safe to call multiple times
 * and when registerInstance failed.
 */
export function unregisterInstance(): void {
  if (!myEntry) return;
  const filePath = path.join(getInstancesDir(), `${process.pid}.json`);
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* file already gone, or never written — fine */
  }
  myEntry = null;
}

/**
 * Are there any OTHER SpecForge instances still alive?
 *
 * Used by the close flow to decide whether to stop the shared agent
 * daemon. False → we're the last one → stop. True → leave the daemon
 * running for the others to reuse.
 *
 * Implementation: scan the instances dir, skip our own file (we delete
 * it before calling this in the close flow, but defensive skip too),
 * and verify each PID is alive AND is a SpecForge process.
 */
export function hasOtherLiveInstances(): boolean {
  const dir = getInstancesDir();
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    console.warn("[instanceCoordinator] hasOtherLiveInstances: cannot read dir", dir);
    return false;
  }
  const pidNameMap = snapshotProcessNames();
  const candidates = files.filter((f) => f.endsWith(".json") && f !== `${process.pid}.json`);
  for (const file of candidates) {
    const entry = readEntry(path.join(dir, file));
    if (!entry) continue;
    const alive = isOwnInstanceAlive(entry.pid, pidNameMap);
    console.log(
      `[instanceCoordinator] scan: ${file} pid=${entry.pid} alive=${alive}` +
        (pidNameMap ? ` name=${pidNameMap.get(entry.pid) ?? "?"}` : " (no-namemap)"),
    );
    if (alive) return true;
  }
  console.log(
    `[instanceCoordinator] hasOtherLiveInstances: scanned ${candidates.length} candidate(s), none alive`,
  );
  return false;
}
