// ---------------------------------------------------------------------------
// OpenSpec 类型定义
// ---------------------------------------------------------------------------
// 对应 OpenSpec 标准目录结构:
//   openspec/
//     specs/<capability>/spec.md          (源真理)
//     changes/<id>/proposal.md
//     changes/<id>/tasks.md
//     changes/<id>/specs/<cap>/spec.md    (delta 增量)
//     changes/<id>/design.md              (可选)
//     changes/archive/<YYYY-MM-DD>-<id>/  (归档)
//
// 参考: https://github.com/Fission-AI/OpenSpec/blob/main/docs/concepts.md
// ---------------------------------------------------------------------------

// ── Scenario / Requirement(源真理 spec 与 delta 共用) ─────────────────

export type SpecLevel = "MUST" | "SHALL" | "SHOULD" | "MAY";

export type ScenarioKeyword = "GIVEN" | "WHEN" | "THEN" | "AND";

export interface ScenarioStep {
  keyword: ScenarioKeyword;
  text: string;
}

export interface OpenSpecScenario {
  name: string;
  steps: ScenarioStep[];
}

export interface OpenSpecRequirement {
  /** 来自 `### Requirement: <Name>` */
  name: string;
  /** 规范关键字强度(RFC 2119) */
  level: SpecLevel;
  /** header 后的正文 */
  text: string;
  scenarios: OpenSpecScenario[];
  /** 所属 capability */
  capability: string;
  /** 来源: 'spec' = 源真理, 'delta' = 某 change 的增量 */
  source: "spec" | "delta";
}

// ── Capability(specs/<cap>/spec.md 维度) ──────────────────────────────

export interface OpenSpecCapability {
  /** kebab-case,如 "auth" */
  name: string;
  /** 相对 openspec 根,如 "specs/auth/spec.md" */
  specPath: string;
  /** 该 spec.md 是否存在 */
  hasSpec: boolean;
  /** `## Purpose` 段内容(若 spec.md 有) */
  purpose?: string;
  /** `### Requirement: <Name>` 列表(解析自 spec.md) */
  requirements?: OpenSpecRequirement[];
}

// ── Delta Spec(changes/<id>/specs/<cap>/spec.md) ───────────────────────

export type OpenSpecDeltaOp = "added" | "modified" | "removed" | "renamed";

export interface OpenSpecDeltaRequirement {
  op: OpenSpecDeltaOp;
  /** ADDED/MODIFIED/REMOVED 的目标 requirement name;RENAMED 时是新名 */
  name: string;
  /** RENAMED 时的原名 */
  fromName?: string;
  /** ADDED/MODIFIED 时附带的完整 requirement;REMOVED/RENAMED 不带 */
  requirement?: OpenSpecRequirement;
  /** REMOVED 时的可选理由 */
  reason?: string;
}

export interface OpenSpecDeltaSpec {
  /** capability name */
  capability: string;
  /** 相对 openspec 根的 delta spec.md 路径 */
  path: string;
  requirements: OpenSpecDeltaRequirement[];
}

// ── Tasks ──────────────────────────────────────────────────────────────

export type OpenSpecTaskStatus = "pending" | "completed";

export interface OpenSpecTask {
  /** 如 "1.1" */
  id: string;
  title: string;
  status: OpenSpecTaskStatus;
  /** 所属分组序号,如 1 */
  groupIndex: number;
  /** 所属分组标题,如 "Data Layer" */
  groupTitle: string;
  /** 关联的 requirement name(可选) */
  requirement?: string;
  /** 验证命令(可选) */
  verification?: string;
  /** 工时估算(分钟,可选) */
  estimate?: number;
  /** 依赖的 task id 列表(可选) */
  dependsOn?: string[];
  /** 完成时附带的验证结果(可选) */
  result?: string;
  /** 该 task 在原始 markdown 行中的 - [ ]/- [x] 所在行(0-based) */
  lineOffset: number;
}

export interface OpenSpecTaskStats {
  total: number;
  completed: number;
  pending: number;
  /** 完成率 0-1 */
  progress: number;
}

export interface OpenSpecTaskGroup {
  title: string;
  groupIndex: number;
  tasks: OpenSpecTask[];
}

// ── Proposal ──────────────────────────────────────────────────────────

export interface OpenSpecProposal {
  raw: string;
  /** `## Why` 或 `## Intent` */
  why?: string;
  /** `## What Changes` 或 `## Scope` */
  whatChanges?: string;
  /** `### New Capabilities` 列表(kebab-case) */
  capabilitiesNew: string[];
  /** `### Modified Capabilities` 列表 */
  capabilitiesModified: string[];
  /** `## Impact` 或 `## Approach` */
  impact?: string;
}

// ── Change ────────────────────────────────────────────────────────────

export interface OpenSpecChange {
  /** kebab-case,如 "add-dark-mode";归档时含日期前缀 */
  id: string;
  /** 相对 openspec 根的目录路径 */
  dirPath: string;
  archived: boolean;
  /** 归档日期 ISO,仅 archived=true 时有 */
  archivedAt?: string;
  proposal?: OpenSpecProposal;
  /** Explore 阶段产出的 brainstorm.md 原文;lean 档无此阶段故为 undefined */
  brainstorm?: string;
  tasks: OpenSpecTask[];
  taskStats: OpenSpecTaskStats;
  deltaSpecs: OpenSpecDeltaSpec[];
  hasDesign: boolean;
  /** 相对 openspec 根的 tasks.md 路径 */
  taskPath: string;
  /** 相对 openspec 根的 proposal.md 路径 */
  proposalPath: string;
}

// ── Validation ────────────────────────────────────────────────────────

export interface OpenSpecValidationIssue {
  file: string;
  line?: number;
  message: string;
  rule?: string;
  severity: "error" | "warning";
}

export interface OpenSpecValidationResult {
  changeId?: string;
  passed: boolean;
  /** CLI 是否可用;false 表示浏览器模式或 CLI 未装 */
  cliAvailable: boolean;
  issues: OpenSpecValidationIssue[];
  rawOutput: string;
  ranAt: number;
}

// ── 项目级状态 ─────────────────────────────────────────────────────────

export interface OpenSpecState {
  /** 当前打开项目的 openspec/ 绝对根路径 */
  rootPath: string;
  /** 该项目是否存在 openspec/ 目录 */
  initialized: boolean;
  capabilities: OpenSpecCapability[];
  activeChanges: OpenSpecChange[];
  archivedChanges: OpenSpecChange[];
  loading: boolean;
  error: string;
  lastRefreshedAt: number;
  /** openspec CLI 是否可用(Electron 模式下探测) */
  cliAvailable: boolean;
  cliVersion?: string;
  /** 按 changeId 索引的最近一次校验结果;"_global" 表示全局 */
  validation: Record<string, OpenSpecValidationResult>;
  /** 按 changeId 索引的多层 gate 证据汇总;"_global" 表示全局 */
  evidence: Record<string, EvidenceFile>;
}

// ── IPC 返回类型 ────────────────────────────────────────────────────────

/** openspec:readState 返回(去掉 loading/error/validation 等渲染态字段) */
export type OpenSpecReadStateResult = Pick<
  OpenSpecState,
  "rootPath" | "initialized" | "capabilities" | "activeChanges" | "archivedChanges"
> & {
  cliAvailable: boolean;
  cliVersion?: string;
};

export interface OpenSpecWriteTasksResult {
  ok: boolean;
  reason?: string;
}

export type GateLayer = "spec" | "lint" | "test" | "build";

export interface GateResult {
  layer: GateLayer;
  command: string;
  /** 退出码;null = 未运行 / 跳过 / CLI 不可用 */
  exitCode: number | null;
  passed: boolean;
  durationMs: number;
  outputSnippet?: string;
}

export type GateVerdict = "READY" | "CONDITIONAL" | "NOT_READY";

/** 写入 openspec/changes/<id>/evidence.json 的结构化证据 */
export interface EvidenceFile {
  changeId: string;
  verdict: GateVerdict;
  gates: GateResult[];
  ranAt: number;
}

/** 通用项目命令执行结果(任意 shell 命令) */
export interface ProjectGateResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/** 写入 change 产物的结果 */
export interface WriteArtifactResult {
  ok: boolean;
  reason?: string;
}

/** Execution Contract — propose 完成时生成,apply 前检查 */
export interface ExecutionContract {
  changeId: string;
  need: string;
  tier: string;
  scope: ScopeBoundary;
  /** 意图锁:一句话锁定本次变更核心意图(提取自 proposal ## Why) */
  intent: string;
  /** 范围围栏:本次明确不做的事(提取自 proposal ## Out of Scope)。Apply 检测到触碰即拦截 */
  outOfScope: string[];
  /** 验收义务:从 delta specs 的 SHALL/MUST 提取,每条必须有对应实现证据 */
  requirements: ContractRequirement[];
  /** 源工件内容指纹(proposal+specs+design 拼接哈希),用于 stale 检测 */
  sourceHash: string;
  verify: { command: string; description?: string }[];
  risks: string[];
  generatedAt: number;
}

export interface ScopeBoundary {
  files: string[];
  api?: string[];
  modules?: string[];
}

/** 契约中的验收义务条目 */
export interface ContractRequirement {
  /** `### Requirement: <Name>` 中的 Name */
  name: string;
  /** RFC 2119 强度 */
  level: SpecLevel;
  /** 相对 openspec 根的来源路径 */
  source: string;
}

/** 契约过期检测结果 */
export type ContractStaleReason =
  | "proposal-scope-expanded"
  | "requirements-changed"
  | "source-hash-mismatch"
  | "missing-contract";

export interface ContractStaleResult {
  stale: boolean;
  reason?: ContractStaleReason;
  /** 人类可读说明 */
  detail?: string;
}

// SidePanel → 详情窗口的导航目标
export type SpecTarget = { kind: "capability"; name: string } | { kind: "archived"; id: string };
