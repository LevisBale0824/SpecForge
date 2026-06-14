// ---------------------------------------------------------------------------
// CLI Bridge REST API Client
// ---------------------------------------------------------------------------
// Typed wrapper functions around the CLI Bridge Server REST API.
// Simplified version of opencode.ts — no authorization, no instance directory.
// ---------------------------------------------------------------------------

type QueryValue = string | number | boolean | undefined;
type JsonBody = Record<string, unknown> | Array<unknown>;

let configuredBaseUrl = "";

export function setBaseUrl(baseUrl: string) {
  configuredBaseUrl = baseUrl.replace(/\/+$/, "");
}

export function getBaseUrl() {
  return configuredBaseUrl;
}

function getBaseUrlOrThrow(errorMessage?: string) {
  if (!configuredBaseUrl) {
    throw new Error(errorMessage ?? "CLI Bridge base URL is not configured.");
  }
  return configuredBaseUrl;
}

function buildQuery(params?: Record<string, QueryValue>) {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    sp.set(key, String(value));
  }
  const q = sp.toString();
  return q ? `?${q}` : "";
}

function createUrl(path: string, params?: Record<string, QueryValue>) {
  return `${getBaseUrlOrThrow()}${path}${buildQuery(params)}`;
}

async function parseJson(response: Response) {
  if (response.status === 204 || response.status === 205) return null;
  if (response.headers.get("content-length") === "0") return null;
  const raw = await response.text();
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

async function getJson(path: string, params?: Record<string, QueryValue>): Promise<unknown> {
  const url = createUrl(path, params);
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`CLI Bridge GET ${path} failed (${response.status}): ${text}`);
  }
  return parseJson(response);
}

async function sendJson(path: string, method: string, body?: JsonBody): Promise<unknown> {
  const url = createUrl(path);
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`CLI Bridge ${method} ${path} failed (${response.status}): ${text}`);
  }
  return parseJson(response);
}

// ── Health ──────────────────────────────────────────────────────────────

export function getGlobalHealth(): Promise<{
  healthy: boolean;
  version: string;
}> {
  return getJson("/global/health") as Promise<{
    healthy: boolean;
    version: string;
  }>;
}

// ── Sessions ────────────────────────────────────────────────────────────

export function createSession(body?: { agent?: string; directory?: string }): Promise<unknown> {
  return sendJson("/session", "POST", body);
}

export function getSession(sessionId: string): Promise<unknown> {
  return getJson(`/session/${sessionId}`);
}

export function listSessions(directory?: string): Promise<unknown> {
  return getJson("/session", directory ? { directory } : undefined);
}

export function deleteSession(sessionId: string): Promise<unknown> {
  return sendJson(`/session/${sessionId}`, "DELETE");
}

export function abortSession(sessionId: string): Promise<void> {
  return sendJson(`/session/${sessionId}/abort`, "POST").then(() => {});
}

// ── Messages ────────────────────────────────────────────────────────────

export function listSessionMessages(sessionId: string): Promise<unknown> {
  return getJson(`/session/${sessionId}/message`);
}

export function sendPromptAsync(
  sessionId: string,
  body: {
    agent?: string;
    parts?: Array<Record<string, unknown>>;
    directory?: string;
  },
): Promise<void> {
  return sendJson(`/session/${sessionId}/prompt_async`, "POST", body).then(() => {});
}

// ── Agents (Phase 2H) ──────────────────────────────────────────────────

export function listAgents(): Promise<Array<{ name: string; type: string }>> {
  return getJson("/global/agents") as Promise<Array<{ name: string; type: string }>>;
}

// ── Files (Phase 3) ────────────────────────────────────────────────────

export function listFiles(payload: { directory: string; path?: string }): Promise<unknown> {
  return getJson("/file", {
    directory: payload.directory,
    path: payload.path,
  });
}

export function readFileContent(payload: { directory: string; path: string }): Promise<unknown> {
  return getJson("/file/content", {
    directory: payload.directory,
    path: payload.path,
  });
}

export function writeFileContent(payload: {
  directory: string;
  path: string;
  content: string;
}): Promise<unknown> {
  return sendJson("/file/content", "POST", payload);
}

// ── Projects (Phase 3) ─────────────────────────────────────────────────

export function getPathInfo(): Promise<{ home: string }> {
  return getJson("/path") as Promise<{ home: string }>;
}

export function openProject(directory: string): Promise<unknown> {
  return sendJson("/project/open", "POST", { directory });
}
