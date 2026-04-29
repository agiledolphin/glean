import { useEffect, useRef } from "react";
import { Clock, Search } from "lucide-react";
import { useAppStore } from "@/store";
import { lookupWord } from "@/lib/commands";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const AVATAR_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-violet-500",
  "bg-orange-500", "bg-rose-500", "bg-cyan-500",
];

function hashIndex(str: string, len: number) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % len;
}

function DictIcon({ dictId, dictName, iconUrl }: { dictId: string; dictName: string; iconUrl?: string }) {
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        className="w-3.5 h-3.5 shrink-0 object-contain rounded-sm"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        alt=""
      />
    );
  }
  const color = AVATAR_COLORS[hashIndex(dictId, AVATAR_COLORS.length)];
  const letter = dictName.trim()[0]?.toUpperCase() ?? "?";
  return (
    <span className={cn("w-3.5 h-3.5 shrink-0 rounded-sm flex items-center justify-center text-white", color)}
      style={{ fontSize: 8, lineHeight: 1 }}>
      {letter}
    </span>
  );
}

export function CandidateList() {
  const {
    candidates, searchQuery,
    highlightedIndex, setHighlightedIndex,
    selectedWord, setSelectedWord,
    dictResults, setDictResults, setIsSearching,
    dictIcons,
  } = useAppStore();

  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (highlightedIndex >= 0) {
      const el = itemRefs.current[highlightedIndex];
      el?.scrollIntoView({ block: "nearest" });
      el?.focus();
    }
  }, [highlightedIndex]);

  const handleListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown"
        ? Math.min(highlightedIndex + 1, candidates.length - 1)
        : Math.max(highlightedIndex - 1, 0);
      setHighlightedIndex(next);
      handleSelect(candidates[next]);
    }
  };

  const handleContainerFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    const { highlightedIndex: hi, candidates: cs, selectedWord: sw } = useAppStore.getState();
    const swIdx = sw ? cs.indexOf(sw) : -1;
    const idx = swIdx >= 0 ? swIdx : (hi >= 0 && hi < cs.length ? hi : 0);
    setHighlightedIndex(idx);
    itemRefs.current[idx]?.focus();
  };

  const handleSelect = async (word: string) => {
    setSelectedWord(word);
    setIsSearching(true);
    try {
      const results = await lookupWord(word);
      setDictResults(results);
    } catch {
      setDictResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const scrollToDict = (dictId: string) => {
    document.getElementById(`dict-section-${dictId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Auto-select when selectedWord changes from navbar Enter
  useEffect(() => {
    if (selectedWord) {
      handleSelect(selectedWord);
    }
  }, [selectedWord]);

  const isHistory = !searchQuery.trim();

  return (
    <div
      id="candidate-list"
      tabIndex={0}
      onFocus={handleContainerFocus}
      className="w-[28%] min-w-[180px] max-w-[260px] border-r border-border flex flex-col outline-none"
    >
      <ScrollArea className="flex-1">
        {candidates.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground">
            <Search size={20} strokeWidth={1.5} />
            <p className="text-xs">输入单词开始查询</p>
          </div>
        ) : (
          <ul className="py-1" onKeyDown={handleListKeyDown}>
            {isHistory && (
              <li className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-muted-foreground/70 select-none">
                <Clock size={11} />
                <span>最近查询</span>
                <span className="ml-auto tabular-nums">{candidates.length}</span>
              </li>
            )}
            {candidates.map((word, idx) => {
              const isSelected = selectedWord === word;
              const isHighlighted = highlightedIndex === idx;
              return (
                <li key={word}>
                  <button
                    ref={(el) => { itemRefs.current[idx] = el; }}
                    tabIndex={-1}
                    onClick={() => handleSelect(word)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors",
                      "hover:bg-accent hover:text-accent-foreground",
                      isSelected && "bg-accent text-accent-foreground font-medium",
                      !isSelected && isHighlighted && "bg-accent/60 text-accent-foreground"
                    )}
                  >
                    <span className="truncate font-dict tracking-[0.015em]">{word}</span>
                  </button>

                  {/* Dict sub-items for the selected word */}
                  {isSelected && dictResults.length > 0 && (
                    <ul className="pb-1">
                      {dictResults.map((r) => (
                        <li key={r.dict_id}>
                          <button
                            onClick={() => scrollToDict(r.dict_id)}
                            className={cn(
                              "w-full flex items-center gap-1.5 pl-7 pr-3 py-1 text-left transition-colors",
                              "text-xs text-muted-foreground",
                              "hover:bg-accent/60 hover:text-accent-foreground"
                            )}
                          >
                            <DictIcon dictId={r.dict_id} dictName={r.dict_name} iconUrl={dictIcons[r.dict_id]} />
                            <span className="truncate">{r.dict_name}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}
