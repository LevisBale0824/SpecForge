import type { SessionInfo, ToolState } from "../../types/sse";

export function extractCommand(input: Record<string, unknown> | undefined): string | undefined {
  const command = typeof input?.command === "string" ? input.command.trim() : "";
  return command || undefined;
}

export function formatGlobToolTitle(
  input: Record<string, unknown> | undefined,
): string | undefined {
  const pattern = typeof input?.pattern === "string" ? input.pattern.trim() : "";
  const path = typeof input?.path === "string" ? input.path.trim() : "";
  const include = typeof input?.include === "string" ? input.include.trim() : "";
  const segments: string[] = [];
  if (pattern) segments.push(pattern);
  if (path) segments.push(`@ ${path}`);
  if (include) segments.push(`include ${include}`);
  const title = segments.join(" ");
  return title || undefined;
}

export function formatReadLikeToolTitle(
  input: Record<string, unknown> | undefined,
): string | undefined {
  const filePath = typeof input?.filePath === "string" ? input.filePath.trim() : "";
  if (filePath) return filePath;
  const path = typeof input?.path === "string" ? input.path.trim() : "";
  return path || undefined;
}

export function resolveReadWritePath(
  input: Record<string, unknown> | undefined,
  metadata: Record<string, unknown> | undefined,
  state: Record<string, unknown> | undefined,
): string | undefined {
  const filePath = typeof input?.filePath === "string" ? input.filePath.trim() : "";
  if (filePath) return filePath;
  const path = typeof input?.path === "string" ? input.path.trim() : "";
  if (path) return path;
  const metadataPath = typeof metadata?.filepath === "string" ? metadata.filepath.trim() : "";
  if (metadataPath) return metadataPath;
  const title = typeof state?.title === "string" ? state.title.trim() : "";
  return title || undefined;
}

export function resolveReadRange(input: Record<string, unknown> | undefined): {
  offset?: number;
  limit?: number;
} {
  const offsetValue = input?.offset;
  const limitValue = input?.limit;
  const offset =
    typeof offsetValue === "number" && Number.isFinite(offsetValue) && offsetValue >= 0
      ? Math.floor(offsetValue)
      : undefined;
  const limit =
    typeof limitValue === "number" && Number.isFinite(limitValue) && limitValue > 0
      ? Math.floor(limitValue)
      : undefined;
  return { offset, limit };
}

export function formatListToolTitle(
  input: Record<string, unknown> | undefined,
): string | undefined {
  const path = typeof input?.path === "string" ? input.path.trim() : "";
  return path || undefined;
}

export function formatWebfetchToolTitle(
  input: Record<string, unknown> | undefined,
): string | undefined {
  const url = typeof input?.url === "string" ? input.url.trim() : "";
  return url || undefined;
}

export function formatQueryToolTitle(
  input: Record<string, unknown> | undefined,
): string | undefined {
  const query = typeof input?.query === "string" ? input.query.trim() : "";
  return query || undefined;
}

export function toolColor(tool: string): string {
  switch (tool) {
    case "bash":
      return "#a855f7";
    case "read":
      return "#60a5fa";
    case "grep":
      return "#facc15";
    case "glob":
      return "#facc15";
    case "list":
      return "#60a5fa";
    case "edit":
    case "multiedit":
    case "apply_patch":
      return "#f97316";
    case "write":
      return "#f97316";
    case "webfetch":
    case "websearch":
    case "codesearch":
      return "#2dd4bf";
    case "task":
      return "#818cf8";
    case "batch":
      return "#818cf8";
    case "plan_enter":
    case "plan_exit":
      return "#94a3b8";
    default:
      return "#64748b";
  }
}

export function guessLanguageFromPath(path?: string): string {
  if (!path) return "text";
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
      return "typescript";
    case "tsx":
      return "tsx";
    case "js":
      return "javascript";
    case "jsx":
      return "jsx";
    case "vue":
      return "vue";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "html":
      return "html";
    case "css":
      return "css";
    case "scss":
      return "scss";
    case "yml":
    case "yaml":
      return "yaml";
    case "diff":
    case "patch":
      return "diff";
    case "sh":
      return "shellscript";
    case "py":
      return "python";
    case "java":
      return "java";
    case "php":
      return "php";
    case "sql":
      return "sql";
    case "rs":
      return "rust";
    case "go":
      return "go";
    case "rb":
      return "ruby";
    case "toml":
      return "toml";
    case "xml":
      return "xml";
    case "c":
      return "c";
    case "cpp":
    case "cc":
    case "cxx":
      return "cpp";
    case "h":
    case "hpp":
      return "cpp";
    default:
      return "text";
  }
}

// ── Sub-agent session navigation ─────────────────────────────────────────
// Primary id source is metadata.sessionId; on interrupt/abort opencode omits
// it (upstream bug #22348/#13910), so we fall back to output text then parentID.

export type SubSessionRef = { sessionId: string; inferred: boolean };

const SUBAGENT_TOOLS = new Set(["task", "batch"]);

export function isSubAgentTool(tool: string): boolean {
  return SUBAGENT_TOOLS.has(tool);
}

const SESSION_ID_KEYS = ["sessionId", "session_id", "subSessionID", "sub_session_id"] as const;

// matches "task_id: <id>" in the tool output text
const TASK_ID_RE = /task_id:\s*([A-Za-z0-9_-]+)/;

export function extractSubSessionId(tool: string, state: ToolState): SubSessionRef | undefined {
  if (!isSubAgentTool(tool)) return undefined;
  const metadata =
    state.status === "pending"
      ? undefined
      : (state.metadata as Record<string, unknown> | undefined);
  if (metadata) {
    for (const key of SESSION_ID_KEYS) {
      const v = metadata[key];
      if (typeof v === "string" && v.trim()) {
        return { sessionId: v.trim(), inferred: false };
      }
    }
  }
  if (state.status === "completed") {
    const m = TASK_ID_RE.exec(state.output);
    if (m?.[1]) return { sessionId: m[1], inferred: true };
  }
  return undefined;
}

export function matchChildSession(
  parentSessionId: string | undefined,
  candidates: SessionInfo[],
  opts: { toolTimeMs?: number; exclude?: Set<string> } = {},
): SubSessionRef | undefined {
  if (!parentSessionId) return undefined;
  const exclude = opts.exclude ?? new Set<string>();
  const kids = candidates.filter((s) => s.parentID === parentSessionId && !exclude.has(s.id));
  if (kids.length === 0) return undefined;
  const toolTimeMs = opts.toolTimeMs;
  if (toolTimeMs === undefined) {
    const latest = [...kids].sort((a, b) => (b.time.created ?? 0) - (a.time.created ?? 0))[0];
    return latest ? { sessionId: latest.id, inferred: true } : undefined;
  }
  let best: SessionInfo | undefined;
  let bestDiff = Infinity;
  for (const k of kids) {
    const createdMs = (k.time.created ?? 0) * 1000;
    const diff = Math.abs(createdMs - toolTimeMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = k;
    }
  }
  return best ? { sessionId: best.id, inferred: true } : undefined;
}
