import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import appIcon from "@/assets/app-icon.png";
import { Book, BarChart3, Settings, Search, Loader2 } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "@/store";
import { searchCandidates, getRecentHistory, areDictsReady, getDictIcons } from "@/lib/commands";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Page } from "@/types";

export function Navbar() {
  const {
    searchQuery, setSearchQuery,
    candidates, setCandidates,
    highlightedIndex, setHighlightedIndex,
    setSelectedWord,
    currentPage, setCurrentPage,
    dictsReady, setDictsReady,
    setDictIcons,
  } = useAppStore();

  useEffect(() => {
    const loadIcons = () => getDictIcons().then(setDictIcons).catch(() => {});
    areDictsReady().then(ready => {
      if (ready) { setDictsReady(true); loadIcons(); }
    });
    const unlisten = listen("dicts-ready", () => { setDictsReady(true); loadIcons(); });
    return () => { unlisten.then(fn => fn()); };
  }, [setDictsReady, setDictIcons]);

  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus and load initial history once dicts are ready
  useEffect(() => {
    if (!dictsReady) return;
    setTimeout(() => inputRef.current?.focus(), 0);
    getRecentHistory(50).then(setCandidates).catch(() => {});
  }, [dictsReady]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleInput = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        if (value.trim()) {
          const results = await searchCandidates(value.trim());
          setCandidates(results);
        } else {
          const recent = await getRecentHistory(50);
          setCandidates(recent);
        }
      } catch {
        setCandidates([]);
      }
    }, 120);
  }, [setSearchQuery, setCandidates]);

  useEffect(() => {
    if (currentPage === "search" && focused) {
      handleInput(searchQuery);
    }
  }, [focused]);

  // "/" shortcut: focus search input and select all existing content
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      setCurrentPage("search");
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [setCurrentPage]);

  const handleHeaderMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, input, a, select, textarea")) return;
    getCurrentWindow().startDragging().catch(() => {});
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex(Math.min(highlightedIndex + 1, candidates.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex(Math.max(highlightedIndex - 1, 0));
    } else if (e.key === "Enter") {
      const word = highlightedIndex >= 0 && candidates[highlightedIndex]
        ? candidates[highlightedIndex]
        : searchQuery.trim() || null;
      if (word) {
        setSelectedWord(word);
        setHighlightedIndex(Math.max(0, candidates.indexOf(word)));
      }
      document.getElementById("candidate-list")?.focus();
    } else if (e.key === "Escape") {
      handleInput("");
      inputRef.current?.select();
    }
  }, [searchQuery, candidates, highlightedIndex, setHighlightedIndex, setSelectedWord, handleInput]);

  const navItems: { page: Page; icon: React.ReactNode; label: string }[] = [
    { page: "vocabulary", icon: <Book size={16} />, label: "生词本" },
    { page: "stats", icon: <BarChart3 size={16} />, label: "统计" },
    { page: "settings", icon: <Settings size={16} />, label: "设置" },
  ];

  return (
    <header
      className="flex items-center gap-3 pl-24 pr-4 h-14 border-b border-border bg-background/95 backdrop-blur-sm select-none shrink-0"
      data-tauri-drag-region
      onMouseDown={handleHeaderMouseDown}
    >
      {/* Logo */}
      <button
        className="flex items-center gap-2 shrink-0 cursor-pointer group"
        onClick={() => setCurrentPage("search")}
        data-tauri-drag-region="false"
      >
        <div className="w-[32px] h-[32px] shrink-0 rounded-lg bg-white shadow-sm ring-1 ring-black/8 flex items-center justify-center">
          <img src={appIcon} alt="Glean" className="w-[26px] h-[26px] object-contain" />
        </div>
        <div className="flex flex-col leading-none gap-[4px]">
          <span className="font-serif text-[15px] font-medium text-foreground tracking-[0.05em] group-hover:text-foreground transition-colors">
            拾词
          </span>
          <span className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground group-hover:text-foreground/70 transition-colors">
            Glean
          </span>
        </div>
      </button>

      {/* Search bar - centered */}
      <div className="flex-1 max-w-md mx-auto relative" data-tauri-drag-region="false">
        <div className="relative">
          {dictsReady
            ? <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            : <Loader2 size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none animate-spin" />
          }
          <Input
            id="search-input"
            ref={inputRef}
            value={searchQuery}
            onChange={(e) => handleInput(e.target.value)}
            onFocus={() => { setFocused(true); setCurrentPage("search"); }}
            onBlur={() => setFocused(false)}
            onKeyDown={handleKeyDown}
            placeholder={dictsReady ? "输入单词查询..." : "词库加载中..."}
            disabled={!dictsReady}
            className={cn(
              "pl-8 h-8 text-sm bg-muted/50 border-transparent focus-visible:bg-background focus-visible:border-border",
              "transition-all duration-150"
            )}
          />
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex items-center gap-1" data-tauri-drag-region="false">
        {navItems.map(({ page, icon, label }) => (
          <Button
            key={page}
            variant="ghost"
            size="sm"
            onClick={() => setCurrentPage(page)}
            className={cn(
              "h-8 px-2.5 gap-1.5 text-xs",
              currentPage === page && "bg-accent text-accent-foreground"
            )}
          >
            {icon}
            <span className="hidden sm:inline">{label}</span>
          </Button>
        ))}

      </nav>
    </header>
  );
}
