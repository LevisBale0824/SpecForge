import { useOpenSpec } from "./useOpenSpec";
import { isElectron, writeChangeArtifact, readChangeArtifact } from "../utils/electronBridge";
import type { ExecutionContract, ScopeBoundary, GateLayer } from "../types/openspec";

const DEFAULT_GATES: { layer: GateLayer; command: string; desc: string }[] = [
  { layer: "lint", command: "npm run lint", desc: "代码风格检查" },
  { layer: "test", command: "npm test", desc: "单元测试" },
  { layer: "build", command: "npm run build", desc: "构建验证" },
];

function inferScope(need: string, proposalRaw: string): ScopeBoundary {
  const files: string[] = [];
  const api: string[] = [];
  if (proposalRaw) {
    const whatMatch = proposalRaw.match(/## What Changes([\s\S]*?)(?=##|$)/);
    if (whatMatch) {
      const lines = whatMatch[1].match(/\/[a-zA-Z_./-]+/g);
      if (lines) lines.forEach((l) => files.push(l.trim()));
    }
  }
  if (need.toLowerCase().includes("login") || need.toLowerCase().includes("auth")) {
    if (!api.includes("POST /auth/login")) api.push("POST /auth/login");
  }
  return {
    files: files.length > 0 ? files : ["src/", "tests/"],
    api: api.length > 0 ? api : undefined,
  };
}

export function useContract() {
  const openspec = useOpenSpec();

  function describeChange(changeId?: string): string {
    const ch = openspec.state.activeChanges.find((c) => c.id === changeId);
    return ch?.proposal?.why ?? ch?.proposal?.whatChanges ?? "";
  }

  async function generateContract(
    changeId: string,
    need: string,
    tier: string,
  ): Promise<{ ok: boolean; contract?: ExecutionContract; reason?: string }> {
    if (!isElectron()) return { ok: false, reason: "仅 Electron 模式支持" };
    const change = openspec.state.activeChanges.find((c) => c.id === changeId);
    if (!change) return { ok: false, reason: "change not found" };
    const proposalRaw = change.proposal?.raw ?? "";
    const scope = inferScope(need, proposalRaw);
    const verify = DEFAULT_GATES.map((g) => ({ command: g.command, description: g.desc }));
    const contract: ExecutionContract = {
      changeId,
      need: need || describeChange(changeId),
      tier,
      scope,
      verify,
      risks: [],
      generatedAt: Date.now(),
    };
    const r = await writeChangeArtifact(
      change.dirPath.startsWith("changes/")
        ? openspec.state.rootPath || "."
        : openspec.state.rootPath,
      changeId,
      "contract.md",
      JSON.stringify(contract, null, 2),
    );
    return r?.ok ? { ok: true, contract } : { ok: false, reason: r?.reason || "写入失败" };
  }

  async function loadContract(changeId: string): Promise<ExecutionContract | null> {
    if (!isElectron()) return null;
    const change = openspec.state.activeChanges.find((c) => c.id === changeId);
    if (!change) return null;
    const root = openspec.state.rootPath || ".";
    const raw = await readChangeArtifact(root, changeId, "contract.md");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ExecutionContract;
    } catch {
      return null;
    }
  }

  return { generateContract, loadContract };
}
