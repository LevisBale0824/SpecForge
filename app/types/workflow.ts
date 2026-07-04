// ---------------------------------------------------------------------------
// OpenSpec Workflow Type Definitions
// ---------------------------------------------------------------------------
// 风险自适应三档流程:lean / standard / thorough。
// 不同档位启用不同阶段子集 — 小改走捷径,大改动才上完整流程。
// ---------------------------------------------------------------------------

/** 流程强度档位 */
export type WorkflowTier = "lean" | "standard" | "thorough";

/** 所有可能的阶段(不同 tier 启用不同子集,按全序排列) */
export type StepName = "explore" | "propose" | "plan" | "apply" | "verify" | "review" | "archive";

/** 单步内的阶段 */
export type StepPhase = "idle" | "input" | "executing" | "reviewing" | "done" | "blocked";

/** 固定全序 — 排序与渲染基准(向后兼容保留) */
export const STEP_ORDER: StepName[] = [
  "explore",
  "propose",
  "plan",
  "apply",
  "verify",
  "review",
  "archive",
];

/** 每档启用哪些阶段(按执行顺序) */
export const TIER_STAGES: Record<WorkflowTier, StepName[]> = {
  lean: ["propose", "apply", "verify", "archive"],
  standard: ["explore", "propose", "apply", "verify", "archive"],
  thorough: ["explore", "propose", "plan", "apply", "verify", "review", "archive"],
};

/** 档位展示标签 */
export const TIER_LABELS: Record<WorkflowTier, string> = {
  lean: "轻量 · 单文件小改",
  standard: "标准 · 模块内功能",
  thorough: "完整 · 跨模块 / 架构级",
};

/** 某档启用的阶段(保持顺序) */
export function stagesForTier(tier: WorkflowTier): StepName[] {
  return TIER_STAGES[tier] ?? TIER_STAGES.standard;
}

/** 某档的入口阶段(轻量档直达 propose,其余从 explore) */
export function entryStageForTier(tier: WorkflowTier): StepName {
  if (tier === "lean") return "propose";
  const stages = stagesForTier(tier);
  return stages[0] ?? "explore";
}

/** 单步状态 */
export type StepState = {
  name: StepName;
  phase: StepPhase;
  sessionId?: string;
  input?: string;
  output?: string;
};

/** 顶层工作流状态 */
export type WorkflowState = {
  tier: WorkflowTier;
  activeStep: StepName;
  label?: string;
  /** 仅当前 tier 启用的阶段会有条目 */
  steps: Partial<Record<StepName, StepState>>;
  enabled: boolean;
};

/** 创建默认工作流状态 */
export function createDefaultWorkflowState(tier: WorkflowTier = "standard"): WorkflowState {
  const steps: Partial<Record<StepName, StepState>> = {};
  for (const name of stagesForTier(tier)) {
    steps[name] = { name, phase: "idle" };
  }
  return {
    tier,
    activeStep: entryStageForTier(tier),
    steps,
    enabled: false,
  };
}
