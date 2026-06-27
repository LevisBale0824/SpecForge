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
//   - On launch: write our own PID file.
//   - On quit: delete our PID file.
//   - On close: scan the directory, check each other PID with
//     process.kill(pid, 0). If none are alive → we're the last.
//
// Race-free: we delete our own file before scanning, so the scan sees
// exactly the set of "other instances still claiming to be alive". PID
// reuse is mitigated by startedAt — but since we delete the file on quit
// and OS-level PID reuse for long-running GUI apps is rare in practice,
// we don't gate on startedAt for the liveness check.
//
// We deliberately do NOT sweep stale entries on launch — old code did
// and it caused races where one instance's sweep removed another's
// just-written PID file. Stale entries are filtered at read time by
// the PID liveness check. Stale files cost nothing functionally and
// get cleaned up by the OS temp dir rotation / reboot.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import { getInstancesDir } from "./paths";

interface InstanceEntry {
  pid: number;
  startedAt: number;
  version?: string;
}

let myEntry: InstanceEntry | null = null;

/** Test whether a PID is alive across platforms. No signal sent. */
function isPidAlive(pid: number): boolean {
  try {
    // process.kill with signal 0 is a POSIX-supported "existence check"
    // that throws if the process doesn't exist. Works on Windows too
    // (Node.js polyfills it via OpenProcess + CloseHandle).
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ESRCH = no such process. EINVAL = signal 0 not supported (impossible).
    // EPERM = exists but we can't signal it — still "alive" from our POV.
    return code === "EPERM";
  }
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
export function registerInstance(version?: string): void {
  if (myEntry) return;
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
 * and check every other PID's liveness via process.kill(pid, 0).
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
  const candidates = files.filter((f) => f.endsWith(".json") && f !== `${process.pid}.json`);
  for (const file of candidates) {
    const entry = readEntry(path.join(dir, file));
    if (!entry) continue;
    const alive = isPidAlive(entry.pid);
    console.log(`[instanceCoordinator] scan: ${file} pid=${entry.pid} alive=${alive}`);
    if (alive) return true;
  }
  console.log(
    `[instanceCoordinator] hasOtherLiveInstances: scanned ${candidates.length} candidate(s), none alive`,
  );
  return false;
}
