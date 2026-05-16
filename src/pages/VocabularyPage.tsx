import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, Star, Plus, FileDown, FileUp, NotebookPen, ChevronDown, Check } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "@/store";
import {
  listVocabulary, countVocabulary, listTags,
  createTag, renameTag, deleteTag, setDefaultTag, exportVocabulary,
  lookupWord, previewImportFile, importVocabularyFromFile,
  updateVocabularyNote,
} from "@/lib/commands";
import { DictResultPanel } from "@/components/DictResultPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { VocabularyItem } from "@/types";

const PAGE_SIZE = 300;

type TagChoice = number | "none" | "new";

export function VocabularyPage() {
  const {
    tags, setTags,
    selectedTagId, setSelectedTagId,
    setSelectedWord, setDictResults, setIsSearching,
  } = useAppStore();

  const [words, setWords] = useState<VocabularyItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const hasMore = words.length < totalCount;

  const [selectedItem, setSelectedItem] = useState<VocabularyItem | null>(null);
  const [hasNoteFilter, setHasNoteFilter] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [addingTag, setAddingTag] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [editingTagName, setEditingTagName] = useState("");

  // Note editor state
  const [noteExpanded, setNoteExpanded] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteDirty, setNoteDirty] = useState(false);

  // Import modal state
  const [importPreview, setImportPreview] = useState<{ total: number; sample: string[] } | null>(null);
  const [importPath, setImportPath] = useState("");
  const [tagChoice, setTagChoice] = useState<TagChoice>("none");
  const [importNewTagName, setImportNewTagName] = useState("");
  const [importResult, setImportResult] = useState<{ imported: number; tag_added: number; skipped: number } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [skipHeader, setSkipHeader] = useState(false);

  // Virtual scroll with dynamic row height
  const listRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: words.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 32,
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan: 10,
  });

  const loadInitial = useCallback(async () => {
    setWords([]);
    const [items, count, tagList] = await Promise.all([
      listVocabulary(selectedTagId, PAGE_SIZE, 0, hasNoteFilter),
      countVocabulary(selectedTagId ?? undefined, hasNoteFilter),
      listTags(),
    ]);
    setWords(items);
    setTotalCount(count);
    setTags(tagList);
  }, [selectedTagId, hasNoteFilter, setTags]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const items = await listVocabulary(selectedTagId, PAGE_SIZE, words.length, hasNoteFilter);
      setWords(prev => [...prev, ...items]);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, selectedTagId, words.length, hasNoteFilter]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadInitial(); }, [selectedTagId, hasNoteFilter]);

  // Trigger load more when virtualizer reaches near end of loaded items
  useEffect(() => {
    const virtualItems = rowVirtualizer.getVirtualItems();
    if (!virtualItems.length || !hasMore || isLoadingMore) return;
    const lastVisible = virtualItems[virtualItems.length - 1];
    if (lastVisible.index >= words.length - 30) {
      loadMore();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowVirtualizer.getVirtualItems()]);

  // Clear search input and dict panel when entering vocabulary page
  useEffect(() => {
    useAppStore.getState().setSearchQuery("");
    useAppStore.getState().setCandidates([]);
    setSelectedWord(null);
    setDictResults([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync note text when selected item changes; intentionally exclude note to avoid re-sync while editing
  useEffect(() => {
    setNoteText(selectedItem?.note ?? "");
    setNoteDirty(false);
    setNoteExpanded(!!(selectedItem?.note));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem?.id]);

  const handleNoteSave = async () => {
    if (!selectedItem || !noteDirty) return;
    await updateVocabularyNote(selectedItem.word, noteText);
    const updated = noteText || null;
    setWords(prev => prev.map(w => w.id === selectedItem.id ? { ...w, note: updated } : w));
    setSelectedItem(prev => prev ? { ...prev, note: updated } : null);
    setNoteDirty(false);
    if (!noteText) setNoteExpanded(false);
  };

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

  const reloadTags = async () => {
    setTags(await listTags());
  };

  const handleAddTag = async () => {
    if (!newTagName.trim()) return;
    const colors = ["#4385be", "#3aa99f", "#8b7ec8", "#879a39", "#da702c"];
    const color = colors[Math.floor(Math.random() * colors.length)];
    await createTag(newTagName.trim(), color);
    setNewTagName("");
    setAddingTag(false);
    reloadTags();
  };

  const handleDeleteTag = (id: number) => {
    if (pendingDeleteId === id) {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      setPendingDeleteId(null);
      deleteTag(id).then(() => {
        if (selectedTagId === id) setSelectedTagId(null);
        reloadTags();
      });
    } else {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      setPendingDeleteId(id);
      deleteTimerRef.current = setTimeout(() => setPendingDeleteId(null), 2000);
    }
  };

  const handleSetDefaultTag = async (id: number, isDefault: boolean) => {
    await setDefaultTag(isDefault ? null : id);
    reloadTags();
  };

  const handleRenameTag = async (id: number) => {
    const name = editingTagName.trim();
    setEditingTagId(null);
    if (!name) return;
    const tag = tags.find(t => t.id === id);
    if (tag && name === tag.name) return;
    await renameTag(id, name);
    reloadTags();
  };

  const handleExport = async () => {
    await exportVocabulary(selectedTagId ?? undefined);
  };

  const handleImportClick = async () => {
    const file = await openDialog({
      multiple: false,
      filters: [{ name: "词汇文件", extensions: ["csv", "json"] }],
    });
    if (!file || typeof file !== "string") return;
    try {
      const preview = await previewImportFile(file, false);
      setImportPath(file);
      setImportPreview(preview);
      setImportResult(null);
      setSkipHeader(false);
      const stem = file.replace(/\\/g, "/").split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
      const matched = tags.find(t => t.name.toLowerCase() === stem.toLowerCase());
      if (matched) {
        setTagChoice(matched.id);
      } else {
        setTagChoice("new");
        setImportNewTagName(stem);
      }
    } catch (e) {
      console.error("Failed to preview import file:", e);
    }
  };

  const handleConfirmImport = async () => {
    if (!importPreview || isImporting) return;
    setIsImporting(true);
    try {
      let finalTagId: number | null = null;
      if (tagChoice === "new") {
        if (!importNewTagName.trim()) { setIsImporting(false); return; }
        const colors = ["#4385be", "#3aa99f", "#8b7ec8", "#879a39", "#da702c"];
        const color = colors[Math.floor(Math.random() * colors.length)];
        const newTag = await createTag(importNewTagName.trim(), color);
        finalTagId = newTag.id;
      } else if (tagChoice === "none") {
        finalTagId = null;
      } else {
        finalTagId = tagChoice;
      }
      const result = await importVocabularyFromFile(importPath, finalTagId, skipHeader);
      setImportResult(result);
      loadInitial();
    } finally {
      setIsImporting(false);
    }
  };

  const closeImportModal = () => {
    setImportPreview(null);
    setImportResult(null);
    setImportPath("");
    setImportNewTagName("");
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Tag filter bar */}
      <div className="grid border-b border-border shrink-0" style={{ gridTemplateColumns: "auto 1fr auto" }}>
        {/* 全部 */}
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
          <span className="text-[11px] text-muted-foreground tabular-nums">{totalCount}</span>
        </div>

        {/* Scrollable chip area */}
        <div className="relative min-w-0">
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none" />
          <div className="flex items-center gap-1.5 px-3 py-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            {tags.map((tag) => {
              const active = selectedTagId === tag.id;
              return (
                <div key={tag.id} className="relative inline-flex items-center shrink-0 tag-chip-wrapper">
                  {editingTagId === tag.id ? (
                    <input
                      autoFocus
                      value={editingTagName}
                      onChange={(e) => setEditingTagName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRenameTag(tag.id);
                        if (e.key === "Escape") setEditingTagId(null);
                      }}
                      onBlur={() => handleRenameTag(tag.id)}
                      className="px-2 py-0.5 rounded-full text-xs font-medium outline-none w-24"
                      style={{
                        backgroundColor: tag.color + "22",
                        color: tag.color,
                        border: `1px solid ${tag.color}cc`,
                      }}
                    />
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => setSelectedTagId(tag.id)}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setEditingTagId(tag.id);
                            setEditingTagName(tag.name);
                          }}
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
                  )}

                  <div className={cn("tag-chip-actions items-center ml-0.5", pendingDeleteId === tag.id && "tag-chip-actions-pinned")}>
                    <button
                      onClick={() => handleSetDefaultTag(tag.id, tag.is_default)}
                      className={cn("p-0.5 rounded transition-colors", tag.is_default ? "text-primary hover:text-primary/70" : "text-muted-foreground hover:text-primary")}
                      title={tag.is_default ? "取消默认" : "设为默认"}
                    >
                      <Star size={10} fill={tag.is_default ? "currentColor" : "none"} />
                    </button>
                    <button
                      onClick={() => handleDeleteTag(tag.id)}
                      className={cn("p-0.5 rounded transition-colors", pendingDeleteId === tag.id ? "text-destructive" : "text-muted-foreground hover:text-destructive")}
                      title={pendingDeleteId === tag.id ? "再次点击确认删除" : "删除标签"}
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>
              );
            })}

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

        {/* Action buttons */}
        <div className="flex items-center px-2 gap-0.5 border-l border-border">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn("gap-1.5 text-xs h-7", hasNoteFilter ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
                onClick={() => setHasNoteFilter(v => !v)}
              >
                <NotebookPen size={12} />
                有笔记
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">仅显示有笔记的单词</TooltipContent>
          </Tooltip>
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-7 text-muted-foreground hover:text-foreground" onClick={handleImportClick}>
            <FileUp size={12} />
            导入
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-7 text-muted-foreground hover:text-foreground" onClick={handleExport}>
            <FileDown size={12} />
            导出
          </Button>
        </div>
      </div>

      {/* Two-column content */}
      <div className="flex flex-1 min-h-0">
        {/* Virtual word list */}
        <div ref={listRef} className="w-52 border-r border-border shrink-0 overflow-y-auto">
          {words.length === 0 && !isLoadingMore && (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <p className="text-xs">暂无收藏单词</p>
            </div>
          )}
          <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
            {rowVirtualizer.getVirtualItems().map((vItem) => {
              const item = words[vItem.index];
              return (
                <div
                  key={vItem.key}
                  data-index={vItem.index}
                  ref={rowVirtualizer.measureElement}
                  style={{ position: "absolute", top: vItem.start, left: 0, right: 0 }}
                >
                  <button
                    onClick={() => handleSelectItem(item)}
                    className={cn(
                      "w-full flex items-start gap-2 px-3 py-1.5 text-left hover:bg-accent transition-colors",
                      selectedItem?.id === item.id && "bg-accent"
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-dict truncate tracking-[0.015em]">{item.word}</p>
                      {item.note && (
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">{item.note}</p>
                      )}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
          {isLoadingMore && (
            <div className="flex justify-center py-2">
              <span className="text-[11px] text-muted-foreground">加载中…</span>
            </div>
          )}
        </div>

        {/* Dict detail + note editor */}
        <div className="flex-1 flex flex-col min-h-0">
          {selectedItem && (
            <div className="shrink-0 border-b border-border">
              {/* Header row */}
              <div
                onClick={() => setNoteExpanded(v => !v)}
                className="flex items-center gap-1.5 px-4 py-1.5 cursor-pointer hover:bg-accent/50 transition-colors"
              >
                <NotebookPen size={12} className="text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground truncate">
                  {!noteExpanded && selectedItem.note ? selectedItem.note : "笔记"}
                </span>
                {noteExpanded && (
                  <button
                    disabled={!noteDirty}
                    onClick={(e) => { e.stopPropagation(); handleNoteSave(); }}
                    className={cn("p-0.5 rounded transition-colors", noteDirty ? "text-primary hover:text-primary/70" : "text-muted-foreground/25 cursor-default")}
                    title="保存"
                  >
                    <Check size={12} />
                  </button>
                )}
                <ChevronDown size={12} className={cn("text-muted-foreground transition-transform ml-auto shrink-0", noteExpanded && "rotate-180")} />
              </div>

              {/* Expanded editor */}
              {noteExpanded && (
                <div className="px-4 pb-2">
                  <textarea
                    autoFocus
                    value={noteText}
                    onChange={(e) => {
                      setNoteText(e.target.value);
                      setNoteDirty(e.target.value !== (selectedItem?.note ?? ""));
                    }}
                    placeholder="添加笔记…"
                    rows={3}
                    className="w-full text-xs text-foreground bg-transparent resize-none outline-none placeholder:text-muted-foreground/40 leading-relaxed"
                  />
                </div>
              )}
            </div>
          )}
          <DictResultPanel />
        </div>
      </div>

      {/* Import modal */}
      {importPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget) closeImportModal(); }}
        >
          <div className="bg-card border border-border rounded-xl shadow-xl w-80 p-5 flex flex-col gap-4">
            {importResult ? (
              <>
                <div className="text-sm font-medium text-foreground">导入完成</div>
                <div className="text-sm text-muted-foreground flex flex-col gap-1">
                  {importResult.imported > 0 && <span>新增 <span className="text-foreground font-medium">{importResult.imported}</span> 个词条</span>}
                  {importResult.tag_added > 0 && <span>补充标签 <span className="text-foreground font-medium">{importResult.tag_added}</span> 个词条</span>}
                  {importResult.skipped > 0 && <span>重复跳过 <span className="text-foreground font-medium">{importResult.skipped}</span> 个词条</span>}
                  {importResult.imported === 0 && importResult.tag_added === 0 && <span>无新增内容</span>}
                </div>
                <div className="flex justify-end">
                  <Button size="sm" onClick={closeImportModal}>完成</Button>
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-medium text-foreground">导入生词</div>
                <div className="text-xs text-muted-foreground">
                  解析到 <span className="text-foreground font-medium">{importPreview.total}</span> 个词条
                  {importPreview.sample.length > 0 && (
                    <span className="ml-1">（{importPreview.sample.join("、")}{importPreview.total > 5 ? "…" : ""}）</span>
                  )}
                </div>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={skipHeader}
                    onChange={async (e) => {
                      const val = e.target.checked;
                      setSkipHeader(val);
                      try {
                        const preview = await previewImportFile(importPath, val);
                        setImportPreview(preview);
                      } catch {}
                    }}
                    className="accent-primary"
                  />
                  <span className="text-xs text-muted-foreground">跳过第一行</span>
                </label>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-muted-foreground">分配标签</label>
                  <select
                    value={tagChoice === "new" ? "new" : tagChoice === "none" ? "none" : String(tagChoice)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setTagChoice(v === "none" ? "none" : v === "new" ? "new" : Number(v));
                    }}
                    className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {tags.map(t => (
                      <option key={t.id} value={String(t.id)}>
                        {t.name}{t.is_default ? " (默认)" : ""}
                      </option>
                    ))}
                    <option value="none">不分配标签</option>
                    <option value="new">+ 新建标签…</option>
                  </select>
                  {tagChoice === "new" && (
                    <Input
                      autoFocus
                      value={importNewTagName}
                      onChange={(e) => setImportNewTagName(e.target.value)}
                      placeholder="标签名称…"
                      className="h-7 text-xs"
                    />
                  )}
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={closeImportModal}>取消</Button>
                  <Button
                    size="sm"
                    disabled={isImporting || (tagChoice === "new" && !importNewTagName.trim())}
                    onClick={handleConfirmImport}
                  >
                    {isImporting ? "导入中…" : "确认导入"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
