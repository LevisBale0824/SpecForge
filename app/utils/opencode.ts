// ---------------------------------------------------------------------------
// OpenCode REST API Client
// ---------------------------------------------------------------------------
// Typed wrapper functions around the OpenCode Server REST API.
// Ported from opencode-visualizer-cn/app/utils/opencode.ts
// ---------------------------------------------------------------------------

import type { CommandInfo } from "../types/command";

type QueryValue = string | number | boolean | undefined;
type JsonBody = Record<string, unknown> | Array<unknown>;

type RequestOptions = {
  instanceDirectory?: string;
  signal?: AbortSignal;
};

let configuredBaseUrl = "";
let configuredAuthorization: string | undefined;

export function setBaseUrl(baseUrl: string) {
  configuredBaseUrl = baseUrl.replace(/\/+$/, "");
}

export function getBaseUrl() {
  return configuredBaseUrl;
}

export function setAuthorization(authorization: string | undefined) {
  configuredAuthorization = authorization;
}

export function getAuthorization() {
  return configuredAuthorization;
}

function getBaseUrlOrThrow(errorMessage?: string) {
  if (!configuredBaseUrl) {
    throw new Error(errorMessage ?? "OpenCode base URL is not configured.");
  }
  return configuredBaseUrl;
}

function buildQuery(params?: Record<string, QueryValue>) {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
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

function buildHeaders(options?: RequestOptions, contentType?: string) {
  const headers: Record<string, string> = {};
  if (contentType) headers["Content-Type"] = contentType;
  if (options?.instanceDirectory) headers["x-opencode-directory"] = options.instanceDirectory;
  if (configuredAuthorization) headers["Authorization"] = configuredAuthorization;
  return Object.keys(headers).length > 0 ? headers : undefined;
}

/**
 * Read up to `limit` chars of the response body for diagnostic logging.
 * Caps size so a huge error page can't blow up the console.
 */
async function readErrorBody(response: Response, limit = 2000): Promise<string> {
  try {
    const raw = await response.text();
    if (!raw) return "";
    return raw.length > limit
      ? `${raw.slice(0, limit)}…<truncated ${raw.length - limit} chars>`
      : raw;
  } catch (e) {
    return `<unreadable body: ${(e as Error).message}>`;
  }
}

async function getJson(
  path: string,
  params?: Record<string, QueryValue>,
  options?: RequestOptions,
) {
  const url = createUrl(path, params);
  const response = await fetch(url, {
    headers: buildHeaders(options),
    signal: options?.signal,
  });
  if (!response.ok) {
    const body = await readErrorBody(response);
    console.error(`[opencode] GET ${path} failed`, {
      status: response.status,
      statusText: response.statusText,
      params,
      url,
      body,
    });
    throw new Error(
      `${path} request failed (${response.status} ${response.statusText})${body ? `: ${body}` : ""}`,
    );
  }
  return parseJson(response);
}

async function sendJson(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  options: {
    params?: Record<string, QueryValue>;
    body?: JsonBody;
    request?: RequestOptions;
  },
) {
  const url = createUrl(path, options.params);
  const response = await fetch(url, {
    method,
    headers: buildHeaders(options.request, "application/json"),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.request?.signal,
  });
  if (!response.ok) {
    const body = await readErrorBody(response);
    console.error(`[opencode] ${method} ${path} failed`, {
      status: response.status,
      statusText: response.statusText,
      params: options.params,
      url,
      requestBody: options.body,
      responseBody: body,
    });
    throw new Error(
      `${path} request failed (${response.status} ${response.statusText})${body ? `: ${body}` : ""}`,
    );
  }
  return parseJson(response);
}

// ── WebSocket URL ─────────────────────────────────────────────────────────

export function createWsUrl(
  path: string,
  params?: Record<string, QueryValue>,
  credentials?: { username: string; password: string },
) {
  const wsBase = getBaseUrlOrThrow().replace(/^http/, "ws");
  const url = `${wsBase}${path}${buildQuery(params)}`;
  if (!credentials) return url;
  const urlObj = new URL(url);
  if (credentials.username || credentials.password) {
    urlObj.username = credentials.username;
    urlObj.password = credentials.password;
  }
  return urlObj.toString();
}

// ── Path / Config ─────────────────────────────────────────────────────────

export function getPathInfo(options?: RequestOptions) {
  return getJson("/path", undefined, options) as Promise<Record<string, string>>;
}

export function getGlobalConfig() {
  return getJson("/global/config") as Promise<unknown>;
}

export function updateGlobalConfig(payload: Record<string, unknown>) {
  return sendJson("/global/config", "PATCH", { body: payload }) as Promise<unknown>;
}

// ── Files ─────────────────────────────────────────────────────────────────

export function listFiles(payload: { directory: string; path?: string }, options?: RequestOptions) {
  return getJson(
    "/file",
    { directory: payload.directory, path: payload.path },
    options,
  ) as Promise<unknown>;
}

export function readFileContent(
  payload: { directory: string; path: string },
  options?: RequestOptions,
) {
  return getJson(
    "/file/content",
    { directory: payload.directory, path: payload.path },
    options,
  ) as Promise<unknown>;
}

export async function readFileContentBytes(
  payload: { directory: string; path: string },
  options?: RequestOptions,
) {
  const url = createUrl("/file/content", {
    directory: payload.directory,
    path: payload.path,
  });
  const response = await fetch(url, {
    headers: buildHeaders(options),
    signal: options?.signal,
  });
  if (!response.ok) {
    const body = await readErrorBody(response);
    console.error(`[opencode] GET /file/content failed`, {
      status: response.status,
      statusText: response.statusText,
      params: payload,
      url,
      responseBody: body,
    });
    throw new Error(
      `/file/content request failed (${response.status} ${response.statusText})${body ? `: ${body}` : ""}`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

export function getSessionDiff(payload: { sessionID: string; directory?: string }) {
  return getJson(`/session/${payload.sessionID}/diff`, {
    directory: payload.directory,
  }) as Promise<unknown>;
}

// ── Projects ──────────────────────────────────────────────────────────────

export function listProjects(directory?: string) {
  return getJson("/project", { directory }) as Promise<unknown>;
}

export function getCurrentProject(directory?: string) {
  return getJson("/project/current", { directory }) as Promise<unknown>;
}

export function updateProject(
  projectId: string,
  payload: {
    directory?: string;
    name?: string;
    icon?: { url?: string; override?: string; color?: string };
    commands?: { start?: string };
  },
) {
  return sendJson(`/project/${projectId}`, "PATCH", {
    params: { directory: payload.directory },
    body: {
      name: payload.name,
      icon: payload.icon,
      commands: payload.commands,
    },
  }) as Promise<unknown>;
}

// ── Sessions ──────────────────────────────────────────────────────────────

export function listSessions(
  options: {
    directory?: string;
    roots?: boolean;
    search?: string;
    limit?: number;
    instanceDirectory?: string;
  } = {},
) {
  return getJson(
    "/session",
    {
      directory: options.directory,
      roots: options.roots ? "true" : undefined,
      search: options.search,
      limit: options.limit,
    },
    { instanceDirectory: options.instanceDirectory },
  ) as Promise<unknown>;
}

export function getSession(sessionId: string, directory?: string, request?: RequestOptions) {
  return getJson(`/session/${sessionId}`, { directory }, request) as Promise<unknown>;
}

export function getSessionChildren(
  sessionId: string,
  directory?: string,
  request?: RequestOptions,
) {
  return getJson(`/session/${sessionId}/children`, { directory }, request) as Promise<unknown>;
}

export function createSession(directory?: string) {
  return sendJson("/session", "POST", {
    params: { directory },
    body: {},
  }) as Promise<unknown>;
}

export async function deleteSession(
  sessionId: string,
  directory?: string,
  request?: RequestOptions,
) {
  return sendJson(`/session/${sessionId}`, "DELETE", {
    params: { directory },
    request,
  });
}

export function updateSession(
  sessionId: string,
  payload: {
    title?: string;
    time?: { archived?: number; pinned?: number };
  },
  directory?: string,
) {
  return sendJson(`/session/${sessionId}`, "PATCH", {
    params: { directory },
    body: payload,
  }) as Promise<unknown>;
}

export function forkSession(sessionId: string, messageId: string, directory?: string) {
  return sendJson(`/session/${sessionId}/fork`, "POST", {
    params: { directory },
    body: { messageID: messageId },
  }) as Promise<unknown>;
}

export function revertSession(sessionId: string, messageId: string, directory?: string) {
  return sendJson(`/session/${sessionId}/revert`, "POST", {
    params: { directory },
    body: { messageID: messageId },
  }) as Promise<unknown>;
}

export function unrevertSession(sessionId: string, directory?: string) {
  return sendJson(`/session/${sessionId}/unrevert`, "POST", {
    params: { directory },
    body: {},
  }) as Promise<unknown>;
}

// ── Worktrees / VCS ───────────────────────────────────────────────────────

export function listWorktrees(directory: string) {
  return getJson("/experimental/worktree", { directory }) as Promise<unknown>;
}

export function getVcsInfo(directory: string) {
  return getJson("/vcs", { directory }) as Promise<unknown>;
}

export function createWorktree(directory: string) {
  return sendJson("/experimental/worktree", "POST", {
    params: { directory },
    body: {},
  }) as Promise<unknown>;
}

export function deleteWorktree(directory: string, targetDirectory: string) {
  return sendJson("/experimental/worktree", "DELETE", {
    params: { directory },
    body: { directory: targetDirectory },
  }) as Promise<unknown>;
}

// ── Providers ─────────────────────────────────────────────────────────────

export function listProviders() {
  return getJson("/provider") as Promise<unknown>;
}

export function listProviderAuthMethods(options: { directory?: string; workspace?: string } = {}) {
  return getJson("/provider/auth", {
    directory: options.directory,
    workspace: options.workspace,
  }) as Promise<unknown>;
}

export function authorizeProviderOAuth(
  providerId: string,
  payload: {
    method: number;
    directory?: string;
    workspace?: string;
    inputs?: Record<string, string>;
  },
) {
  return sendJson(`/provider/${providerId}/oauth/authorize`, "POST", {
    params: { directory: payload.directory, workspace: payload.workspace },
    body: { method: payload.method, inputs: payload.inputs },
  }) as Promise<unknown>;
}

export function completeProviderOAuth(
  providerId: string,
  payload: {
    method: number;
    code?: string;
    directory?: string;
    workspace?: string;
  },
) {
  return sendJson(`/provider/${providerId}/oauth/callback`, "POST", {
    params: { directory: payload.directory, workspace: payload.workspace },
    body: { method: payload.method, code: payload.code },
  }) as Promise<unknown>;
}

export function setProviderAuth(providerId: string, payload: Record<string, unknown>) {
  return sendJson(`/auth/${providerId}`, "PUT", {
    body: payload,
  }) as Promise<unknown>;
}

export function deleteProviderAuth(providerId: string) {
  return sendJson(`/auth/${providerId}`, "DELETE", { body: {} }) as Promise<unknown>;
}

// ── Agents / Commands ─────────────────────────────────────────────────────

export function listAgents() {
  return getJson("/agent") as Promise<unknown>;
}

export async function listCommands(directory?: string): Promise<CommandInfo[]> {
  const raw = (await getJson("/command", { directory })) as
    | Array<Record<string, unknown>>
    | undefined;
  if (!Array.isArray(raw)) return [];
  // Normalize: the command id field may be `id`, `command`, or `name` depending
  // on backend version. Display name prefers `title`/`name` over the raw id.
  return raw
    .map((item) => {
      const id = String(item.id ?? item.command ?? item.name ?? "");
      const name = item.title ? String(item.title) : item.name ? String(item.name) : undefined;
      const description = item.description ? String(item.description) : undefined;
      const category = item.category ? String(item.category) : undefined;
      return { id, name, description, category } as CommandInfo;
    })
    .filter((c) => c.id.length > 0);
}

// ── Status / Permissions / Questions ──────────────────────────────────────

export function getSessionStatusMap(directory?: string, request?: RequestOptions) {
  return getJson("/session/status", { directory }, request) as Promise<unknown>;
}

export function listPendingPermissions(directory?: string) {
  return getJson("/permission", { directory }) as Promise<unknown>;
}

export function listPendingQuestions(directory?: string) {
  return getJson("/question", { directory }) as Promise<unknown>;
}

// ── Messages ──────────────────────────────────────────────────────────────

export function listSessionMessages(
  sessionId: string,
  options: { directory?: string; limit?: number } = {},
) {
  return getJson(`/session/${sessionId}/message`, {
    directory: options.directory,
    limit: options.limit,
  }) as Promise<unknown>;
}

export function getSessionMessage(sessionId: string, messageId: string, directory?: string) {
  return getJson(`/session/${sessionId}/message/${messageId}`, {
    directory,
  }) as Promise<unknown>;
}

export function getSessionTodos(sessionId: string, directory?: string) {
  return getJson(`/session/${sessionId}/todo`, { directory }) as Promise<unknown>;
}

// ── PTY ───────────────────────────────────────────────────────────────────

export function listPtys(directory?: string) {
  return getJson("/pty", { directory }) as Promise<unknown>;
}

export function createPty(
  payload: {
    directory?: string;
    cwd?: string;
    command?: string;
    args?: string[];
    title?: string;
  },
  request?: RequestOptions,
) {
  return sendJson("/pty", "POST", {
    params: { directory: payload.directory },
    body: {
      command: payload.command,
      args: payload.args,
      cwd: payload.cwd,
      title: payload.title,
    },
    request,
  }) as Promise<unknown>;
}

export function updatePtySize(
  ptyId: string,
  payload: { directory?: string; rows: number; cols: number },
) {
  return sendJson(`/pty/${ptyId}`, "PUT", {
    params: { directory: payload.directory },
    body: { size: { rows: payload.rows, cols: payload.cols } },
  }) as Promise<unknown>;
}

export function deletePty(ptyId: string, directory?: string) {
  return sendJson(`/pty/${ptyId}`, "DELETE", {
    params: { directory },
  }) as Promise<unknown>;
}

// ── Prompt / Abort / Command ──────────────────────────────────────────────

export async function sendCommand(
  sessionId: string,
  payload: {
    directory?: string;
    command: string;
    arguments: string;
    agent?: string;
    model?: string;
    variant?: string;
  },
) {
  await sendJson(`/session/${sessionId}/command`, "POST", {
    params: { directory: payload.directory },
    body: payload,
  });
}

export async function sendPromptAsync(
  sessionId: string,
  payload: {
    directory: string;
    agent: string;
    model?: { providerID?: string; modelID: string };
    variant?: string;
    parts: Array<Record<string, unknown>>;
  },
) {
  const body: Record<string, unknown> = {
    agent: payload.agent,
    variant: payload.variant,
    parts: payload.parts,
  };
  if (payload.model) {
    body.model = { ...payload.model, variant: payload.variant };
  }
  // Diagnostic summary: avoid dumping full text (could be large) — log part
  // types/paths so @-attachment issues are easy to spot.
  const partsSummary = payload.parts.map((p) => {
    const t = (p as { type?: string }).type;
    if (t === "file") {
      const src = (p as { source?: { path?: string } }).source;
      return `file(${src?.path ?? "<missing path>"})`;
    }
    if (t === "text") {
      const txt = (p as { text?: string }).text ?? "";
      return `text(${txt.length} chars)`;
    }
    return `${t ?? "unknown"}`;
  });
  console.info("[opencode] POST /prompt_async", {
    sessionId,
    directory: payload.directory || "<empty>",
    agent: payload.agent,
    variant: payload.variant,
    model: payload.model,
    partsCount: payload.parts.length,
    parts: partsSummary,
  });
  await sendJson(`/session/${sessionId}/prompt_async`, "POST", {
    params: { directory: payload.directory },
    body,
  });
}

export async function abortSession(sessionId: string, directory?: string) {
  await sendJson(`/session/${sessionId}/abort`, "POST", {
    params: { directory },
  });
}

// ── Part patch / Permission / Question replies ────────────────────────────

export async function patchMessagePart(payload: {
  sessionID: string;
  messageID: string;
  partID: string;
  part: Record<string, unknown>;
  directory?: string;
}) {
  return sendJson(
    `/session/${payload.sessionID}/message/${payload.messageID}/part/${payload.partID}`,
    "PATCH",
    { params: { directory: payload.directory }, body: payload.part },
  ) as Promise<unknown>;
}

export async function replyPermission(
  requestId: string,
  payload: { directory?: string; reply: string },
) {
  await sendJson(`/permission/${requestId}/reply`, "POST", {
    params: { directory: payload.directory },
    body: { reply: payload.reply },
  });
}

export async function replyQuestion(
  requestId: string,
  payload: { directory?: string; answers: string[][] },
) {
  await sendJson(`/question/${requestId}/reply`, "POST", {
    params: { directory: payload.directory },
    body: { answers: payload.answers },
  });
}

export async function rejectQuestion(requestId: string, directory?: string) {
  await sendJson(`/question/${requestId}/reject`, "POST", {
    params: { directory },
  });
}

// ── Health / MCP / LSP / Skills ───────────────────────────────────────────

export function getGlobalHealth() {
  return getJson("/global/health") as Promise<{
    healthy: boolean;
    version: string;
  }>;
}

export function getMcpStatus() {
  return getJson("/mcp") as Promise<unknown>;
}

export function getLspStatus() {
  return getJson("/lsp") as Promise<unknown>;
}

export function updateMcp(payload: { name: string; config: Record<string, unknown> }) {
  return sendJson("/mcp", "POST", { body: payload }) as Promise<unknown>;
}

export function getSkillStatus() {
  return getJson("/skill") as Promise<unknown>;
}
