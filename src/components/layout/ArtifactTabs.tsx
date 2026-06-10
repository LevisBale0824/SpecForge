import { useWorkflowStore } from "../../stores/workflow";

interface ArtifactTabsProps {
  activeArtifact: string | null;
  onSelect: (artifactId: string) => void;
}

export function ArtifactTabs({ activeArtifact, onSelect }: ArtifactTabsProps) {
  const { artifacts, reviewedArtifacts } = useWorkflowStore();
  if (artifacts.length === 0) return null;

  return (
    <div className="flex border-b border-slate-700 bg-slate-900 overflow-x-auto">
      {artifacts.map((artifact) => {
        const isActive = artifact.id === activeArtifact;
        const isReviewed = reviewedArtifacts.has(artifact.id);
        return (
          <button key={artifact.id} onClick={() => onSelect(artifact.id)} className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 transition-all ${isActive ? "text-sky-400 border-sky-400 bg-sky-950" : isReviewed ? "text-emerald-400 border-transparent" : "text-slate-400 border-transparent hover:text-slate-200"}`}>
            {isReviewed && <span className="mr-1">✓</span>}📄 {artifact.fileName}
          </button>
        );
      })}
    </div>
  );
}
