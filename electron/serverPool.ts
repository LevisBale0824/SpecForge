// ---------------------------------------------------------------------------
// serverPool: spawn / kill / health-check the opencode or zero CLI daemon.
//
// Extracted from main.ts so we can evolve the lifecycle (detached spawn,
// multi-kind coexistence, zombie detection) without bloating main.ts. The
// pool keeps one entry per AgentKind — port numbers are distinct
// (opencode=13284, zero=13286) so the two can run side by side, which lets
// agent switching avoid killing a server other instances might still use.
// ---------------------------------------------------------------------------

import { spawn, execSync, type ChildProcess } from "node:child_process";
import * as http from "node:http";
import * as net from "node:net";

export type AgentKind = "opencode" | "zero";

export type AgentConfig = {
  kind: AgentKind;
  opencodePort: number;
  zeroPort: number;
};

export type ServerStatus = {
  running: boolean;
  port: number;
  pid: number;
};

interface AgentServerEntry {
  /** ChildProcess when we spawned it; null when we adopted an external
   *  detached server (e.g. one left running by a crashed previous primary).
   *  In the null case stopServer falls back to killing by port lookup. */
  proc: ChildProcess | null;
  port: number;
  pid: number;
  healthy: boolean;
  startedAt: number;
  kind: AgentKind;
  /** True if this entry represents a server we didn't spawn ourselves. */
  external: boolean;
}

// ── State ─────────────────────────────────────────────────────────────────

const DEFAULT_AGENT_CONFIG: AgentConfig = {
  kind: "opencode",
  opencodePort: 13284,
  zeroPort: 13286,
};

// Agent kind is intentionally NOT persisted across launches. Boot always
// starts opencode (the safe default). If the user previously switched to an
// agent whose CLI isn't installed, persisting that choice would brick every
// subsequent launch. Switching during a session updates this in-memory value.
let agentConfig: AgentConfig = { ...DEFAULT_AGENT_CONFIG };

const serverPool = new Map<AgentKind, AgentServerEntry>();

// Per-kind auto-respawn state. Each spawned ChildProcess is tracked in
// `intentionallyKilled` when stopServer() deliberately terminates it; the
// exit handler consults this set rather than a module-level boolean so it
// survives the race where stopServer→startServer resets state before the
// old proc's exit event fires. `failureCounts` drives exponential backoff
// per kind and eventually gives up (so a missing CLI doesn't burn CPU
// forever).
const intentionallyKilled = new WeakSet<ChildProcess>();
const failureCounts = new Map<AgentKind, number>();
const respawnTimers = new Map<AgentKind, ReturnType<typeof setTimeout>>();
const MAX_RESPAWN_ATTEMPTS = 10;
const MAX_RESPAWN_BACKOFF_MS = 30_000;

// ── Internal helpers ──────────────────────────────────────────────────────

function clearRespawnTimer(kind: AgentKind): void {
  const t = respawnTimers.get(kind);
  if (t) {
    clearTimeout(t);
    respawnTimers.delete(kind);
  }
}

function portFor(kind: AgentKind): number {
  return kind === "zero" ? agentConfig.zeroPort : agentConfig.opencodePort;
}

/**
 * Kill a spawned CLI process and its entire descendant tree.
 *
 * Why this exists: both Windows and Unix spawn a wrapper process that forks
 * the actual daemon. Killing only the wrapper leaves the daemon orphaned and
 * still bound to the port, so the next spawn on the same port fails with
 * EADDRINUSE.
 *
 * - Windows: `spawn(cmd, args, { shell: true })` launches
 *   `cmd.exe → opencode.cmd → node.exe`. `taskkill /F /T /PID` walks the
 *   tree and kills every descendant.
 * - Unix: the CLI bin (an npm shebang script or compiled launcher) forks a
 *   daemon child. We spawn with `detached: true` so the child becomes its
 *   own process-group leader (pgid == pid), then `process.kill(-pid)` sends
 *   the signal to the entire group — wrapper, daemon, and any grandchildren.
 */
function killProcessTree(proc: ChildProcess): void {
  if (!proc.pid) return;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: "ignore" });
    } catch (err) {
      // Most likely the process already exited between the .killed check and
      // this call. The exit handler has run (or will run) and updated state.
      console.warn(`[electron] taskkill /T failed for PID ${proc.pid}:`, err);
    }
  } else {
    // Send the signal to the entire process group. Requires the child to
    // have been spawned with detached:true so pgid == pid. Falls back to a
    // direct signal if the group kill fails (e.g. already reaped).
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {
      try {
        proc.kill("SIGTERM");
      } catch {
        // already dead — ignore
      }
    }
  }
}

function scheduleRespawn(kind: AgentKind, reason: string): void {
  const failures = failureCounts.get(kind) ?? 0;
  if (failures >= MAX_RESPAWN_ATTEMPTS) {
    console.error(
      `[electron] giving up respawn for ${kind} after ${MAX_RESPAWN_ATTEMPTS} consecutive failures (last reason: ${reason})`,
    );
    return;
  }
  failureCounts.set(kind, failures + 1);
  const backoff = Math.min(1000 * 2 ** failures, MAX_RESPAWN_BACKOFF_MS);
  console.warn(
    `[electron] ${kind} died (${reason}), respawning in ${backoff}ms (attempt ${failures + 1}/${MAX_RESPAWN_ATTEMPTS})`,
  );
  clearRespawnTimer(kind);
  const timer = setTimeout(() => {
    respawnTimers.delete(kind);
    void startServer(kind);
  }, backoff);
  respawnTimers.set(kind, timer);
}

async function healthCheck(port: number, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(`http://localhost:${port}/global/health`, (res) => {
          res.resume();
          if (res.statusCode === 200) resolve();
          else reject(new Error(`status ${res.statusCode}`));
        });
        req.on("error", reject);
        req.setTimeout(2000, () => {
          req.destroy();
          reject(new Error("timeout"));
        });
      });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
}

// ── Public API ────────────────────────────────────────────────────────────

export function getAgentConfig(): AgentConfig {
  return agentConfig;
}

export function getActiveKind(): AgentKind {
  return agentConfig.kind;
}

/** Merge a partial config update into the active agentConfig. */
export function updateAgentConfig(next: Partial<AgentConfig>): AgentConfig {
  // IMPORTANT: when the renderer sends kind: "opencode" we must accept it as
  // "opencode", not fall back to the current agentConfig.kind. The previous
  // logic (`next.kind === "zero" ? "zero" : agentConfig.kind`) silently kept
  // the old kind when the user clicked the opencode button, so rollback
  // after a failed zero-switch and the Restart button both failed to bring
  // opencode back up.
  const merged: AgentConfig = {
    kind: next.kind === "zero" ? "zero" : "opencode",
    opencodePort:
      typeof next.opencodePort === "number" ? next.opencodePort : agentConfig.opencodePort,
    zeroPort: typeof next.zeroPort === "number" ? next.zeroPort : agentConfig.zeroPort,
  };
  agentConfig = merged;
  return merged;
}

/**
 * Start the CLI daemon for the given (or current) kind. No-op if that kind
 * is already running. Other kinds in the pool are left untouched — ports do
 * not conflict, so agent switching can keep the previous server alive for
 * any other SpecForge instance still using it.
 */
export async function startServer(kind: AgentKind = agentConfig.kind): Promise<void> {
  const existing = serverPool.get(kind);
  if (existing?.healthy) return; // already running — nothing to do
  if (existing) {
    // Unhealthy entry (previous spawn's healthCheck failed or it died in a way
    // the exit handler hasn't yet observed). Tear it down before respawning so
    // we don't leak a port-bound zombie or get stuck returning early on the
    // next switch attempt.
    stopServer(kind);
  }
  // Clear any zombie holding the port from a previous SpecForge run that
  // crashed mid-spawn or was killed externally. Without this, the new spawn
  // would fail to bind the port (EADDRINUSE on the daemon side).
  await detectAndCleanZombie(kind);
  // After cleanup, check whether a healthy detached server is already
  // holding the port. This happens after a primary crash where the new
  // primary is promoted: the server process itself survived (detached),
  // and spawning a duplicate would fail. Adopt it instead.
  if (await isPortListening(portFor(kind))) {
    if (await healthCheck(portFor(kind), 2000)) {
      console.log(`[electron] adopting existing healthy ${kind} server on port ${portFor(kind)}`);
      serverPool.set(kind, {
        proc: null,
        port: portFor(kind),
        pid: 0,
        healthy: true,
        startedAt: Date.now(),
        kind,
        external: true,
      });
      failureCounts.delete(kind);
      return;
    }
  }
  // Cancel any pending respawn from a previous failure — this is a fresh
  // attempt (manual restart, agent switch, or initial boot).
  clearRespawnTimer(kind);

  const isWin = process.platform === "win32";
  const port = portFor(kind);
  const baseCmd = kind === "zero" ? "zero" : "opencode";
  const cmd = isWin ? `${baseCmd}.cmd` : baseCmd;

  const proc = spawn(cmd, ["serve", "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
    // Unix: detached:true makes the child its own process-group leader so
    // SIGHUP from the parent shell doesn't take it down on parent exit, and
    // so we can later kill the whole tree via process.kill(-pid).
    // Windows: processes don't die with their parent by default (no Job
    // Object), so detached is unnecessary AND would force a new console
    // window that ignores windowsHide when spawning through .cmd — that's
    // the "Warning: OPENCODE_SERVER_PASSWORD..." popup users saw. So we
    // explicitly opt out on Windows.
    detached: !isWin,
    shell: isWin,
    windowsHide: true,
  });
  proc.unref();
  serverPool.set(kind, {
    proc,
    port,
    pid: proc.pid ?? 0,
    healthy: false,
    startedAt: Date.now(),
    kind,
    external: false,
  });

  proc.stdout?.on("data", (data: Buffer) => {
    console.log(`[${kind}]`, data.toString().trim());
  });

  proc.stderr?.on("data", (data: Buffer) => {
    console.error(`[${kind}]`, data.toString().trim());
  });

  proc.on("error", (err) => {
    console.error(`[electron] Failed to start ${kind}:`, err);
    // Only mutate global state if this proc is still current (not replaced).
    const entry = serverPool.get(kind);
    if (entry?.proc === proc) {
      serverPool.delete(kind);
    }
    if (!intentionallyKilled.has(proc)) {
      scheduleRespawn(kind, `spawn error: ${err.message}`);
    }
  });

  proc.on("exit", (code) => {
    console.log(`[electron] ${kind} exited with code`, code);
    const entry = serverPool.get(kind);
    if (entry?.proc === proc) {
      serverPool.delete(kind);
    }
    if (!intentionallyKilled.has(proc)) {
      scheduleRespawn(kind, `exit code ${code}`);
    }
    intentionallyKilled.delete(proc);
  });

  const healthy = await healthCheck(port);
  // If we were superseded while healthCheck was running (another startServer
  // replaced us, or stopServer cleared the pool), bail without touching
  // state or logging. This avoids the "N concurrent healthCheck timeouts all
  // log 'zero server health check failed'" noise during a respawn storm.
  const entryAfter = serverPool.get(kind);
  if (entryAfter?.proc !== proc) return;
  if (healthy) {
    failureCounts.delete(kind);
    serverPool.set(kind, { ...entryAfter, healthy: true });
    console.log(`[electron] ${kind} server healthy on port`, port);
  } else {
    console.warn(`[electron] ${kind} server health check failed`);
  }
}

/** Stop a single kind's server. Defaults to the active kind.
 *  Also kills any detached server holding the port that we didn't spawn
 *  ourselves (e.g. one left behind by a crashed previous primary). */
export function stopServer(kind: AgentKind = agentConfig.kind): void {
  clearRespawnTimer(kind);
  const entry = serverPool.get(kind);
  if (entry) {
    if (entry.proc && !entry.proc.killed) {
      intentionallyKilled.add(entry.proc);
      killProcessTree(entry.proc);
    }
    // opencode serve daemonizes: the spawn wrapper exits early and the real
    // server becomes an orphan outside the wrapper's tree, so
    // killProcessTree(proc.pid) hits a dead PID. Always fall back to a
    // port-based kill to reach the actual listener.
    killPidHoldingPort(entry.port);
    serverPool.delete(kind);
    return;
  }
  // No entry in our pool — do NOT kill by port. A secondary reusing a
  // shared server has no entry but the server belongs to another instance;
  // killPidHoldingPort here would sever that peer's connection. If a true
  // zombie exists on this port, detectAndCleanZombie (called from
  // startServer) handles it.
}

/** Stop every running kind. Used during shutdown. Covers both pooled and
 *  detached/external servers so a primary transition doesn't strand daemons. */
export function stopAllServers(): void {
  // Try both kinds — no-op for kinds whose port is free.
  const kinds: AgentKind[] = ["opencode", "zero"];
  for (const kind of kinds) {
    stopServer(kind);
  }
}

/**
 * Detect and clean a zombie server for the given kind.
 *
 * A zombie is: the port is occupied (some process is listening on it) but
 * /global/health does not respond. This happens when a previous SpecForge
 * crashed mid-spawn, or when the user killed the daemon in Task Manager
 * leaving a half-dead wrapper process bound to the port. Without this
 * cleanup, the next startServer would see "port in use" and either fail
 * (EADDRINUSE on the daemon side) or silently connect to a dead endpoint.
 *
 * Implementation:
 *   1. Probe the port with a TCP connect — if nothing is listening, return.
 *   2. HTTP GET /global/health with a short timeout. If it responds 200,
 *      the server is healthy — leave it alone (another SpecForge instance
 *      owns it; we should reuse rather than respawn).
 *   3. If the health check fails, find the PID holding the port and kill
 *      its tree so the next startServer can bind cleanly.
 *
 * Returns true if a zombie was found and cleaned.
 */
export async function detectAndCleanZombie(kind: AgentKind): Promise<boolean> {
  const port = portFor(kind);
  if (!(await isPortListening(port))) return false;
  const healthy = await healthCheck(port, 2000);
  if (healthy) return false;
  console.warn(`[electron] zombie ${kind} server detected on port ${port}, cleaning up`);
  killPidHoldingPort(port);
  // Give the OS a moment to release the port.
  await new Promise((r) => setTimeout(r, 300));
  return true;
}

async function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    const cleanup = () => {
      socket.destroy();
    };
    socket.once("connect", () => {
      cleanup();
      resolve(true);
    });
    socket.once("timeout", () => {
      cleanup();
      resolve(false);
    });
    socket.once("error", () => {
      cleanup();
      resolve(false);
    });
    socket.connect(port, "127.0.0.1");
  });
}

function killPidHoldingPort(port: number): void {
  const isWin = process.platform === "win32";
  try {
    if (isWin) {
      // Windows netstat -ano output looks like:
      //   TCP    127.0.0.1:13284        0.0.0.0:0              LISTENING       12345
      // We split on whitespace, take the local address column, match the
      // ":PORT" suffix, and grab the trailing PID column.
      const out = execSync(`netstat -ano -p TCP`, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const pids = new Set<number>();
      for (const raw of out.split(/\r?\n/)) {
        const parts = raw.trim().split(/\s+/);
        if (parts.length < 5 || parts[0] !== "TCP") continue;
        const localAddr = parts[1];
        const state = parts[parts.length - 2];
        const pidStr = parts[parts.length - 1];
        if (state !== "LISTENING") continue;
        if (!localAddr.endsWith(`:${port}`)) continue;
        const pid = parseInt(pidStr, 10);
        if (Number.isFinite(pid) && pid > 0) pids.add(pid);
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
        } catch {
          // best-effort — process may have exited between netstat and kill
        }
      }
    } else {
      // `lsof -ti :PORT` returns PIDs of processes holding the port, one per line.
      const out = execSync(`lsof -ti tcp:${port} || true`, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      for (const line of out.split(/\r?\n/)) {
        const pid = parseInt(line, 10);
        if (Number.isFinite(pid) && pid > 0) {
          try {
            process.kill(pid, "SIGTERM");
          } catch {
            // best-effort — process may already be gone
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[electron] killPidHoldingPort(${port}) failed:`, err);
  }
}

/**
 * Restart a kind's server (stop + start). Defaults to the active kind.
 * Other kinds in the pool are unaffected.
 *
 * Used by the user-facing "Restart" button to recover from an externally
 * killed daemon (e.g. user killed opencode.exe in Task Manager). Agent
 * switching does NOT route through here — see switchAgent.
 */
export async function restartServer(kind: AgentKind = agentConfig.kind): Promise<void> {
  stopServer(kind);
  await startServer(kind);
}

/**
 * Switch the active agent: update agentConfig.kind and ensure the target
 * kind's server is running. Other kinds' servers are left untouched.
 *
 * Why we don't kill the previous kind: opencode (13284) and zero (13286)
 * listen on different ports, so both can run side by side. In a multi-
 * instance setup another SpecForge window may still be using the previous
 * kind — killing it here would sever that window's connection. Each kind's
 * server cleans up when its own owner shuts down (see stopAllServers /
 * instanceRegistry).
 *
 * `next` is merged via updateAgentConfig so callers don't need to normalize
 * kind/ports themselves.
 */
export async function switchAgent(
  next: Partial<AgentConfig>,
): Promise<{ config: AgentConfig; status: ServerStatus }> {
  const merged = updateAgentConfig(next);
  await startServer(merged.kind);
  return { config: getAgentConfig(), status: getServerStatus() };
}

export function getServerStatus(): ServerStatus {
  const entry = serverPool.get(agentConfig.kind);
  if (!entry) {
    return { running: false, port: 0, pid: 0 };
  }
  return {
    running: entry.healthy,
    port: entry.port,
    pid: entry.pid,
  };
}
