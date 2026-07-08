import { useOpenSpec } from "./useOpenSpec";
import { isElectron, writeChangeArtifact, readChangeArtifact } from "../utils/electronBridge";
import type {
  ExecutionContract,
  ScopeBoundary,
  GateLayer,
  ContractRequirement,
  ContractStaleResult,
  OpenSpecChange,
  OpenSpecProposal,
  SpecLevel,
} from "../types/openspec";

const DEFAULT_GATES: { layer: GateLayer; command: string; desc: string }[] = [
  { layer: "lint", command: "npm run lint", desc: "代码风格检查" },
  { layer: "test", command: "npm test", desc: "单元测试" },
  { layer: "build", command: "npm run build", desc: "构建验证" },
];

const SECTION_OUT_OF_SCOPE = /##\s*Out\s*of\s*Scope\s*([\s\S]*?)(?=\n##\s|$)/i;
const SECTION_WHY = /##\s*(?:Why|Intent)\s*([\s\S]*?)(?=\n##\s|$)/i;
const PATH_LIKE = /(^|\s)(\/[a-zA-Z_./-]+|[a-zA-Z_][a-zA-Z0-9_-]*\/[a-zA-Z_./-]+)/g;
const REQ_LEVEL = /\b(MUST|SHALL|SHOULD|MAY)\b/;

function extractOutOfScope(proposalRaw: string): string[] {
  if (!proposalRaw) return [];
  const m = proposalRaw.match(SECTION_OUT_OF_SCOPE);
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

function extractIntent(proposalRaw: string, fallback: string): string {
  if (!proposalRaw) return fallback.slice(0, 140);
  const m = proposalRaw.match(SECTION_WHY);
  if (!m) return fallback.slice(0, 140);
  const firstPara = m[1].split("\n\n")[0].replace(/\s+/g, " ").trim();
  return firstPara.slice(0, 140) || fallback.slice(0, 140);
}

function extractRequirements(change: OpenSpecChange): ContractRequirement[] {
  const out: ContractRequirement[] = [];
  for (const delta of change.deltaSpecs ?? []) {
    for (const dr of delta.requirements ?? []) {
      if (dr.op === "removed" || dr.op === "renamed") continue;
      const text = dr.requirement?.text ?? "";
      const levelMatch = text.match(REQ_LEVEL);
      out.push({
        name: dr.name,
        level: (levelMatch?.[1] as SpecLevel) ?? "SHALL",
        source: delta.path,
        scenarios: (dr.requirement?.scenarios ?? []).map((s) => ({ name: s.name })),
      });
    }
  }
  return out;
}

function collectScopeFiles(proposalRaw: string): string[] {
  if (!proposalRaw) return [];
  const m = proposalRaw.match(/##\s*What\s*Changes\s*([\s\S]*?)(?=\n##\s|$)/i);
  if (!m) return [];
  const hits = m[1].match(PATH_LIKE);
  return hits ? hits.map((s) => s.trim()).filter((p) => p.length > 1) : [];
}

function inferScope(need: string, proposalRaw: string): ScopeBoundary {
  const files = collectScopeFiles(proposalRaw);
  const api: string[] = [];
  if (need.toLowerCase().includes("login") || need.toLowerCase().includes("auth")) {
    if (!api.includes("POST /auth/login")) api.push("POST /auth/login");
  }
  return {
    files: files.length > 0 ? files : ["src/", "tests/"],
    api: api.length > 0 ? api : undefined,
  };
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

function computeSourceHash(opts: { proposalRaw: string; change: OpenSpecChange }): string {
  const reqDump = opts.change.deltaSpecs
    ?.map((d) =>
      d.requirements
        ?.map((r) => {
          const scn = r.requirement?.scenarios?.map((s) => s.name).join(",") ?? "";
          return `${d.capability}:${r.op}:${r.name}:${r.requirement?.text ?? ""}:${scn}`;
        })
        .join("\n"),
    )
    .join("\n");
  return djb2(`${opts.proposalRaw}##${reqDump ?? ""}`);
}

function namesOf(reqs: ContractRequirement[]): Set<string> {
  return new Set(reqs.map((r) => `${r.source}::${r.name}`));
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
    const proposal: OpenSpecProposal | undefined = change.proposal;
    const scope = inferScope(need, proposalRaw);
    const verify = DEFAULT_GATES.map((g) => ({ command: g.command, description: g.desc }));
    const contract: ExecutionContract = {
      changeId,
      need: need || describeChange(changeId),
      tier,
      scope,
      intent: extractIntent(proposalRaw, need),
      outOfScope: extractOutOfScope(proposalRaw),
      requirements: extractRequirements(change),
      sourceHash: computeSourceHash({ proposalRaw, change }),
      verify,
      risks: [],
      generatedAt: Date.now(),
    };
    void proposal;
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

  /**
   * 语义级 stale 检测:契约是否还能代表当前规划工件。
   * 判据:文件缺失 → missing-contract;sourceHash 不一致 → source-hash-mismatch;
   * 当前 proposal 提取的意图/范围超出契约 → proposal-scope-expanded;
   * 当前 delta specs 的验收点集合变化 → requirements-changed。
   */
  function checkStale(
    changeId: string,
    contract: ExecutionContract | null | undefined,
  ): ContractStaleResult {
    const change = openspec.state.activeChanges.find((c) => c.id === changeId);
    if (!change) return { stale: false };
    if (!contract) return { stale: true, reason: "missing-contract", detail: "未生成执行契约" };

    const currentHash = computeSourceHash({ proposalRaw: change.proposal?.raw ?? "", change });
    if (currentHash !== contract.sourceHash) {
      return {
        stale: true,
        reason: "source-hash-mismatch",
        detail: "proposal / specs 自契约生成后被修改",
      };
    }

    const currentReqs = namesOf(extractRequirements(change));
    const contractReqs = namesOf(contract.requirements ?? []);
    if (currentReqs.size !== contractReqs.size) {
      return {
        stale: true,
        reason: "requirements-changed",
        detail: "delta specs 的 Requirement 集合发生变化",
      };
    }
    for (const r of currentReqs)
      if (!contractReqs.has(r)) {
        return {
          stale: true,
          reason: "requirements-changed",
          detail: `新增验收点 ${r}`,
        };
      }

    const newOutOfScope = extractOutOfScope(change.proposal?.raw ?? "");
    if (newOutOfScope.length < (contract.outOfScope?.length ?? 0)) {
      return {
        stale: true,
        reason: "proposal-scope-expanded",
        detail: "proposal 的 Out of Scope 被收窄,本次范围扩张",
      };
    }
    return { stale: false };
  }

  return { generateContract, loadContract, checkStale };
}

/**
 * 计算契约的 Requirements 覆盖情况,支持 scenario 级追溯。
 *
 * 覆盖判定分层:
 * - Requirement 级:每个 SHALL/MUST 须有 completed task 以 `- Requirement: <name>` 绑定
 * - Scenario 级:若 task 显式绑定了任一 `- Scenario: <name>`,则该 requirement 进入
 *   严格模式,每个 scenario 都须有显式绑定;否则宽松回退 —— 只要 requirement 有
 *   completed task 即视为覆盖全部 scenario(兼容存量 tasks.md)
 * - 旧契约(contract.requirements[].scenarios 为空)→ 回退到 requirement 级
 *
 * 用于 Verify 阶段前置门禁:任一未覆盖 → verdict 应为 NOT_READY。
 */
export interface CoverageGap {
  /** 整个 requirement 无 completed task 绑定(missingScenarios 为空)，
   *  或 requirement 下有 scenario 被显式绑定但部分 scenario 漏绑(missingScenarios 非空)。 */
  requirement: string;
  /** 未覆盖的 scenario 名;空数组表示该 requirement 整体无 task 绑定。 */
  missingScenarios: string[];
}

export function checkRequirementsCoverage(
  change: OpenSpecChange | undefined,
  contract: ExecutionContract | null | undefined,
): { covered: string[]; uncovered: string[]; gaps: CoverageGap[] } {
  if (!change || !contract?.requirements?.length) {
    return {
      covered: [],
      uncovered: contract?.requirements?.map((r) => r.name) ?? [],
      gaps: [],
    };
  }
  const covered: string[] = [];
  const uncovered: string[] = [];
  const gaps: CoverageGap[] = [];

  for (const r of contract.requirements) {
    const tasksForReq = change.tasks.filter(
      (t) => t.status === "completed" && t.requirement === r.name,
    );
    if (tasksForReq.length === 0) {
      uncovered.push(r.name);
      gaps.push({ requirement: r.name, missingScenarios: [] });
      continue;
    }
    const scenarioNames = (r.scenarios ?? []).map((s) => s.name);
    if (scenarioNames.length === 0) {
      // 旧契约或 spec 无 scenario → requirement 级判定
      covered.push(r.name);
      continue;
    }
    const explicitScenarios = new Set(
      tasksForReq.map((t) => t.scenario).filter(Boolean) as string[],
    );
    // 宽松回退:所有 task 都没显式绑 scenario → 视为覆盖全部(兼容存量 tasks.md)
    if (explicitScenarios.size === 0) {
      covered.push(r.name);
      continue;
    }
    // 严格模式:每个 scenario 须有显式绑定
    const missing = scenarioNames.filter((s) => !explicitScenarios.has(s));
    if (missing.length === 0) {
      covered.push(r.name);
    } else {
      uncovered.push(r.name);
      gaps.push({ requirement: r.name, missingScenarios: missing });
    }
  }
  return { covered, uncovered, gaps };
}
