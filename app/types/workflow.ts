// ---------------------------------------------------------------------------
// OpenSpec Workflow Type Definitions
// ---------------------------------------------------------------------------
// 风险自适应三档流程:Quick / Standard / Full。
// 不同档位启用不同阶段子集 — 小需求走捷径,大改动才上完整流程。
// ---------------------------------------------------------------------------

/** 流程强度档位 */
export type WorkflowTier = "quick" | "standard" | "full";

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
  quick: ["propose", "apply", "verify", "archive"],
  standard: ["explore", "propose", "apply", "verify", "archive"],
  full: ["explore", "propose", "plan", "apply", "verify", "review", "archive"],
};

/** 档位展示标签 */
export const TIER_LABELS: Record<WorkflowTier, string> = {
  quick: "Quick · 小需求",
  standard: "Standard · 单模块",
  full: "Full · 跨模块",
};

/** 某档启用的阶段(保持顺序) */
export function stagesForTier(tier: WorkflowTier): StepName[] {
  return TIER_STAGES[tier] ?? TIER_STAGES.standard;
}

/** 某档的入口阶段(Quick 直达 propose,其余从 explore) */
export function entryStageForTier(tier: WorkflowTier): StepName {
  if (tier === "quick") return "propose";
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
