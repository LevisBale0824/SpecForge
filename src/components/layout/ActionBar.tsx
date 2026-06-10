import { useWorkflowStore } from "../../stores/workflow";

interface ActionBarProps {
  onMarkReviewed: () => void;
  onRetry: () => void;
  onNext: () => void;
}

export function ActionBar({ onMarkReviewed, onRetry, onNext }: ActionBarProps) {
  const { artifacts, reviewedArtifacts } = useWorkflowStore();
  const allReviewed = artifacts.length > 0 && artifacts.every((a) => reviewedArtifacts.has(a.id));

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-t border-slate-700 bg-slate-800">
      <div className="flex gap-1">
        {artifacts.map((a) => (
          <div key={a.id} className={`w-6 h-1 rounded ${reviewedArtifacts.has(a.id) ? "bg-emerald-400" : "bg-slate-600"}`} />
        ))}
      </div>
      <span className="text-xs text-slate-400">
        产物 <strong className="text-sky-400">{reviewedArtifacts.size}/{artifacts.length}</strong> 已审阅
      </span>
      <button onClick={onMarkReviewed} className="px-3 py-1.5 rounded-md border border-emerald-400 text-emerald-400 text-xs hover:bg-emerald-400/10">✓ 标记已审阅</button>
      <button onClick={onRetry} className="px-3 py-1.5 rounded-md border border-slate-600 text-slate-400 text-xs hover:border-slate-400">🔄 重新执行</button>
      <button onClick={onNext} disabled={!allReviewed} className={`ml-auto px-5 py-2 rounded-lg font-bold text-sm transition-all ${allReviewed ? "bg-gradient-to-r from-emerald-400 to-sky-400 text-slate-900 hover:opacity-90" : "bg-slate-700 text-slate-500 opacity-50 cursor-not-allowed"}`}>下一步 →</button>
    </div>
  );
}
