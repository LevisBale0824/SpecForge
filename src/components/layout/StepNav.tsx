import { STEP_ORDER, useWorkflowStore, StepName } from "../../stores/workflow";

const STEP_LABELS: Record<StepName, string> = { explore: "Explore", propose: "Propose", apply: "Apply", archive: "Archive" };
const STEP_ICONS: Record<StepName, string> = { explore: "🔍", propose: "📋", apply: "⚡", archive: "📦" };

export function StepNav() {
  const { currentStep } = useWorkflowStore();
  const currentIdx = STEP_ORDER.indexOf(currentStep);

  return (
    <nav className="flex items-center gap-1 bg-slate-900 rounded-xl p-1">
      {STEP_ORDER.map((step, idx) => {
        const isCurrent = step === currentStep;
        const isDone = idx < currentIdx;
        return (
          <div key={step} className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm transition-all ${isCurrent ? "bg-slate-800 text-sky-400 font-semibold" : isDone ? "text-emerald-400" : "text-slate-500"}`}>
            <span>{isDone ? "✓" : STEP_ICONS[step]}</span>
            <span>{STEP_LABELS[step]}</span>
          </div>
        );
      })}
    </nav>
  );
}
