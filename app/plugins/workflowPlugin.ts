// ---------------------------------------------------------------------------
// OpenSpec Workflow Plugin
// ---------------------------------------------------------------------------
// 风险自适应工作流:按 tier 启用不同阶段子集。
// Lean:      propose→apply→verify→archive
// Standard:  explore→propose→apply→verify→archive
// Thorough:  explore→propose→plan→apply→verify→review→archive
// ---------------------------------------------------------------------------

import type { App } from "vue";
import type { OpenSpecPlugin } from "./pluginTypes";
import {
  createDefaultWorkflowState,
  entryStageForTier,
  stagesForTier,
  type StepName,
  type StepPhase,
  type WorkflowState,
  type WorkflowTier,
} from "../types/workflow";
import { ref } from "vue";

// ── Module-level workflow state ───────────────────────────────────────────

const workflowState = ref<WorkflowState>(createDefaultWorkflowState());
const workflowEnabled = ref(false);
/** 由外部(如 TierPickerDialog)请求创建新探索;WorkflowStudio 监听后执行 pick */
const pendingNewDraftTier = ref<WorkflowTier | null>(null);
function requestNewDraft(tier: WorkflowTier) {
  pendingNewDraftTier.value = tier;
}
/** 由 WorkflowStudio 请求重新打开档位选择对话框(切换档位);App.vue 监听后开弹窗 */
const pickerOpenRequested = ref(false);
function requestOpenPicker() {
  pickerOpenRequested.value = true;
}

function ensureStep(step: StepName): StepState {
  const steps = workflowState.value.steps;
  if (!steps[step]) steps[step] = { name: step, phase: "idle" };
  return steps[step]!;
}

// re-import locally to avoid cycle confusion in type-only position
type StepState = import("../types/workflow").StepState;

function setStepPhase(step: StepName, phase: StepPhase) {
  ensureStep(step).phase = phase;
}

function setActiveStep(step: StepName) {
  workflowState.value.activeStep = step;
}

/** 切换档位 — 重建 steps(按新 tier),保留已有阶段的 phase */
function setTier(tier: WorkflowTier) {
  const old = workflowState.value.steps;
  const steps: Partial<Record<StepName, StepState>> = {};
  for (const name of stagesForTier(tier)) {
    steps[name] = old[name] ?? { name, phase: "idle" };
  }
  workflowState.value = {
    ...workflowState.value,
    tier,
    steps,
    activeStep: entryStageForTier(tier),
  };
}

function resetWorkflow() {
  workflowState.value = createDefaultWorkflowState(workflowState.value.tier);
}

function enableWorkflow() {
  workflowEnabled.value = true;
  workflowState.value.enabled = true;
}

function disableWorkflow() {
  workflowEnabled.value = false;
  workflowState.value.enabled = false;
  resetWorkflow();
}

/** 当前 tier 的启用阶段(有序) */
function activeStages(): StepName[] {
  return stagesForTier(workflowState.value.tier);
}

function nextStep(): boolean {
  const order = activeStages();
  const current = workflowState.value.activeStep;
  const idx = order.indexOf(current);
  if (idx < 0 || idx >= order.length - 1) return false;
  const next = order[idx + 1];
  setActiveStep(next);
  setStepPhase(next, "input");
  setStepPhase(current, "done");
  return true;
}

/**
 * Step 3 — Archive gate:仅当 verify 阶段处于 done(证据已通过)才允许归档。
 * 确定性拦截,不依赖人记。Lean/Standard/Thorough 都含 verify,故统一适用。
 */
function canArchive(): boolean {
  const v = workflowState.value.steps.verify;
  return v?.phase === "done";
}

export const workflowPlugin: OpenSpecPlugin = {
  name: "openspec-workflow",
  description: "Risk-adaptive workflow: Lean / Standard / Thorough",
  enabled: false,

  install(app: App) {
    app.provide("workflowState", workflowState);
    app.provide("workflowEnabled", workflowEnabled);

    app.config.globalProperties.$workflow = {
      state: workflowState,
      enabled: workflowEnabled,
      pendingNewDraftTier,
      requestNewDraft,
      pickerOpenRequested,
      requestOpenPicker,
      setActiveStep,
      setStepPhase,
      setTier,
      activeStages,
      nextStep,
      canArchive,
      reset: resetWorkflow,
      enable: enableWorkflow,
      disable: disableWorkflow,
    };
  },
};

// ── Composable ────────────────────────────────────────────────────────────

export function useWorkflow() {
  return {
    state: workflowState,
    enabled: workflowEnabled,
    pendingNewDraftTier,
    requestNewDraft,
    pickerOpenRequested,
    requestOpenPicker,
    setActiveStep,
    setStepPhase,
    setTier,
    activeStages,
    nextStep,
    canArchive,
    reset: resetWorkflow,
    enable: enableWorkflow,
    disable: disableWorkflow,
  };
}
