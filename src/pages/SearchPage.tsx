import { CandidateList } from "@/components/CandidateList";
import { DictResultPanel } from "@/components/DictResultPanel";

export function SearchPage() {
  return (
    <div className="flex flex-1 min-h-0">
      <CandidateList />
      <DictResultPanel />
    </div>
  );
}
