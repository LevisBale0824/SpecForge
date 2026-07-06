// ---------------------------------------------------------------------------
// OpenSpec Workflow Type Definitions
// ---------------------------------------------------------------------------
// 风险自适应两档流程:standard / thorough。
// 两档都走完整阶段(差异在 review 是否启用 + 深度),不再跳阶段。
// plan 阶段已合并进 apply(先拆 tasks 再 TDD 执行)。
// ---------------------------------------------------------------------------

/** 流程强度档位 */
export type WorkflowTier = "standard" | "thorough";

/** 所有可能的阶段(不同 tier 启用不同子集,按全序排列) */
export type StepName = "explore" | "propose" | "apply" | "verify" | "review" | "archive";

/** 单步内的阶段 */
export type StepPhase = "idle" | "input" | "executing" | "reviewing" | "done" | "blocked";

/** 固定全序 — 排序与渲染基准(向后兼容保留) */
export const STEP_ORDER: StepName[] = [
  "explore",
  "propose",
  "apply",
  "verify",
  "review",
  "archive",
];

/** 每档启用哪些阶段(按执行顺序) */
export const TIER_STAGES: Record<WorkflowTier, StepName[]> = {
  standard: ["explore", "propose", "apply", "verify", "archive"],
  thorough: ["explore", "propose", "apply", "verify", "review", "archive"],
};

/** 档位展示标签(i18n key,由消费方经 t() 渲染) */
export const TIER_LABELS: Record<WorkflowTier, string> = {
  standard: "workflow.tiers.standard",
  thorough: "workflow.tiers.thorough",
};

/** 某档启用的阶段(保持顺序) */
export function stagesForTier(tier: WorkflowTier): StepName[] {
  return TIER_STAGES[tier] ?? TIER_STAGES.standard;
}

/** 某档的入口阶段(两档都从 explore 开始) */
export function entryStageForTier(tier: WorkflowTier): StepName {
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
  /** 仅当前 tier 启用的阶段才会有条目 */
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
