import { useEffect, useRef, useState } from "react";
import { Trash2, Star, Plus, FileDown } from "lucide-react";
import { useAppStore } from "@/store";
import {
  listVocabulary, listTags,
  createTag, deleteTag, setDefaultTag, exportVocabulary,
  lookupWord,
} from "@/lib/commands";
import { DictResultPanel } from "@/components/DictResultPanel";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { VocabularyItem } from "@/types";

export function VocabularyPage() {
  const {
    vocabulary, setVocabulary, tags, setTags,
    selectedTagId, setSelectedTagId,
    setSelectedWord, setDictResults, setIsSearching,
  } = useAppStore();
  const [selectedItem, setSelectedItem] = useState<VocabularyItem | null>(null);
  const [newTagName, setNewTagName] = useState("");
  const [addingTag, setAddingTag] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = async () => {
    const [vocab, tagList] = await Promise.all([
      listVocabulary(selectedTagId ?? undefined),
      listTags(),
    ]);
    setVocabulary(vocab);
    setTags(tagList);
  };

  useEffect(() => { loadData(); }, [selectedTagId]);

  // Clear search input and dict panel when entering vocabulary page
  useEffect(() => {
    useAppStore.getState().setSearchQuery("");
    useAppStore.getState().setCandidates([]);
    setSelectedWord(null);
    setDictResults([]);
  }, []);

  const handleSelectItem = async (item: VocabularyItem) => {
    setSelectedItem(item);
    setSelectedWord(item.word);
    setIsSearching(true);
    try {
      const results = await lookupWord(item.word);
      setDictResults(results);
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddTag = async () => {
    if (!newTagName.trim()) return;
    const colors = ["#8FAF8F", "#C9A98A", "#9BB5C8", "#B8A8C8", "#C8B8A8"];
    const color = colors[Math.floor(Math.random() * colors.length)];
    await createTag(newTagName.trim(), color);
    setNewTagName("");
    setAddingTag(false);
    loadData();
  };

  const handleDeleteTag = (id: number) => {
    if (pendingDeleteId === id) {
      // Confirmed — execute
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      setPendingDeleteId(null);
      deleteTag(id).then(() => {
        if (selectedTagId === id) setSelectedTagId(null);
        loadData();
      });
    } else {
      // First click — arm
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      setPendingDeleteId(id);
      deleteTimerRef.current = setTimeout(() => setPendingDeleteId(null), 2000);
    }
  };

  const handleSetDefaultTag = async (id: number, isDefault: boolean) => {
    await setDefaultTag(isDefault ? null : id);
    loadData();
  };

  const handleExport = async () => {
    await exportVocabulary(selectedTagId ?? undefined);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Tag filter bar */}
      <div className="grid border-b border-border shrink-0" style={{ gridTemplateColumns: "auto 1fr auto" }}>
        {/* 全部 — fixed, never scrolls */}
        <div className="flex items-center gap-1.5 pl-4 pr-2 border-r border-border">
          <button
            onClick={() => setSelectedTagId(null)}
            className={cn(
              "inline-flex items-center px-2.5 py-1 rounded-full text-xs transition-colors",
              selectedTagId === null
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
            )}
          >
            全部
          </button>
          <span className="text-[11px] text-muted-foreground tabular-nums">{vocabulary.length}</span>
        </div>

        {/* Scrollable chip area */}
        <div className="relative min-w-0">
          {/* Right fade */}
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none" />
          <div
            className="flex items-center gap-1.5 px-3 py-2 overflow-x-auto"
            style={{ scrollbarWidth: "none" }}
          >
            {/* Tag chips */}
            {tags.map((tag) => {
              const active = selectedTagId === tag.id;
              return (
                <div
                  key={tag.id}
                  className="relative inline-flex items-center shrink-0 tag-chip-wrapper"
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setSelectedTagId(tag.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors"
                        style={{
                          backgroundColor: active ? tag.color + "44" : tag.color + "22",
                          color: tag.color,
                          border: `1px solid ${tag.color}${active ? "cc" : tag.is_default ? "aa" : "88"}`,
                        }}
                      >
                        {tag.is_default && <Star size={8} fill="currentColor" className="opacity-70 shrink-0" />}
                        <span className="max-w-[100px] truncate">{tag.name}</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{tag.name}</TooltipContent>
                  </Tooltip>

                  {/* Hover actions */}
                  <div className={cn(
                    "tag-chip-actions items-center ml-0.5",
                    pendingDeleteId === tag.id && "tag-chip-actions-pinned"
                  )}>
                    <button
                      onClick={() => handleSetDefaultTag(tag.id, tag.is_default)}
                      className={cn(
                        "p-0.5 rounded transition-colors",
                        tag.is_default ? "text-primary hover:text-primary/70" : "text-muted-foreground hover:text-primary"
                      )}
                      title={tag.is_default ? "取消默认" : "设为默认"}
                    >
                      <Star size={10} fill={tag.is_default ? "currentColor" : "none"} />
                    </button>
                    <button
                      onClick={() => handleDeleteTag(tag.id)}
                      className={cn(
                        "p-0.5 rounded transition-colors",
                        pendingDeleteId === tag.id
                          ? "text-destructive"
                          : "text-muted-foreground hover:text-destructive"
                      )}
                      title={pendingDeleteId === tag.id ? "再次点击确认删除" : "删除标签"}
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Add tag */}
            {addingTag ? (
              <Input
                autoFocus
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddTag(); if (e.key === "Escape") setAddingTag(false); }}
                onBlur={() => { if (!newTagName.trim()) setAddingTag(false); }}
                placeholder="标签名..."
                className="h-6 text-xs w-24 px-2 shrink-0"
              />
            ) : (
              <button
                onClick={() => setAddingTag(true)}
                className="inline-flex items-center px-2 py-1 rounded-full text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
                title="新建标签"
              >
                <Plus size={11} />
              </button>
            )}
          </div>
        </div>

        {/* Export button — second grid column */}
        <div className="flex items-center px-2 border-l border-border">
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-7 text-muted-foreground hover:text-foreground" onClick={handleExport}>
            <FileDown size={12} />
            导出
          </Button>
        </div>
      </div>

      {/* Two-column content */}
      <div className="flex flex-1 min-h-0">
        {/* Word list */}
        <ScrollArea className="w-52 border-r border-border shrink-0">
          <ul className="py-1">
            {vocabulary.length === 0 && (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                <p className="text-xs">暂无收藏单词</p>
              </div>
            )}
            {vocabulary.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => handleSelectItem(item)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent transition-colors",
                    selectedItem?.id === item.id && "bg-accent"
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-dict truncate">{item.word}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {item.level > 0 && (
                        <div className="flex gap-0.5">
                          {[1, 2, 3, 4, 5].map(n => (
                            <Star key={n} size={9}
                              className={n <= item.level ? "text-yellow-500" : "text-muted-foreground/20"}
                              fill={n <= item.level ? "currentColor" : "none"}
                            />
                          ))}
                        </div>
                      )}
                      {item.tags.map((t) => (
                        <span
                          key={t.id}
                          className="text-[10px] px-1 rounded"
                          style={{ backgroundColor: t.color + "33", color: t.color, border: `1px solid ${t.color}99` }}
                        >
                          {t.name}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>

        {/* Dict detail */}
        <div className="flex-1 flex flex-col min-h-0">
          <DictResultPanel />
        </div>
      </div>
    </div>
  );
}
