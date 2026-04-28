import { useState, useEffect, useRef } from "react";
import appIcon from "@/assets/app-icon.png";
import { BookmarkPlus, BookmarkCheck, Volume2, Loader2, ChevronDown, ChevronRight, Tag as TagIcon } from "lucide-react";
import { useAppStore } from "@/store";
import { addToVocabulary, removeFromVocabulary, isInVocabulary, getVocabularyTags, playPronunciation, playMddAudio, listTags, addTagToWord, removeTagFromWord } from "@/lib/commands";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { Tag } from "@/types";

export function DictResultPanel() {
  const { selectedWord, dictResults, isSearching } = useAppStore();
  const [inVocab, setInVocab] = useState(false);
  const [vocabLoading, setVocabLoading] = useState(false);
  const [playingAudio, setPlayingAudio] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [activeTagIds, setActiveTagIds] = useState<Set<number>>(new Set());
  const [showTagPanel, setShowTagPanel] = useState(false);

  // Load tags once on mount
  useEffect(() => {
    listTags().then(tags => setAllTags(tags)).catch(() => {});
  }, []);

  // Reset collapsed state when the word changes
  useEffect(() => { setCollapsed(new Set()); }, [selectedWord]);

  const toggleCollapse = (dictId: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(dictId) ? next.delete(dictId) : next.add(dictId);
      return next;
    });

  useEffect(() => {
    if (!selectedWord) return;
    isInVocabulary(selectedWord).then(async (inVoc) => {
      setInVocab(inVoc);
      if (inVoc) {
        const tags = await getVocabularyTags(selectedWord).catch(() => [] as Tag[]);
        setActiveTagIds(new Set(tags.map(t => t.id)));
      } else {
        setActiveTagIds(new Set()); // uncollected: no pre-selection
      }
    }).catch(() => setInVocab(false));
  }, [selectedWord, allTags]);


  const handleVocabToggle = async () => {
    if (!selectedWord) return;
    setVocabLoading(true);
    try {
      if (inVocab) {
        await removeFromVocabulary(selectedWord);
        setInVocab(false);
      } else {
        const tagArr = Array.from(activeTagIds);
        await addToVocabulary(selectedWord, tagArr[0] ?? null, 0);
        for (const tid of tagArr.slice(1)) {
          await addTagToWord(selectedWord, tid).catch(console.error);
        }
        setInVocab(true);
        // Sync actual saved tags (backend may have applied default tag)
        const savedTags = await getVocabularyTags(selectedWord).catch(() => [] as Tag[]);
        setActiveTagIds(new Set(savedTags.map(t => t.id)));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setVocabLoading(false);
    }
  };

  const handleTagToggle = async (tagId: number) => {
    const next = new Set(activeTagIds);
    if (next.has(tagId)) {
      next.delete(tagId);
      if (inVocab && selectedWord) removeTagFromWord(selectedWord, tagId).catch(console.error);
    } else {
      next.add(tagId);
      if (inVocab && selectedWord) addTagToWord(selectedWord, tagId).catch(console.error);
    }
    setActiveTagIds(next);
  };

  const handlePlay = async () => {
    if (!selectedWord) return;
    setPlayingAudio(true);
    try {
      await playPronunciation(selectedWord);
    } catch {
      // TTS may not be available
    } finally {
      setTimeout(() => setPlayingAudio(false), 1000);
    }
  };

  if (!selectedWord && !isSearching) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-8 select-none">
        <div className="w-24 h-24 rounded-2xl bg-white shadow-md ring-1 ring-black/8 flex items-center justify-center">
          <img src={appIcon} alt="Glean" className="w-[78px] h-[78px] object-contain" />
        </div>
        <div className="flex flex-col items-center gap-2.5">
          <div className="flex items-center gap-4">
            <div className="w-10 h-px bg-border" />
            <p className="font-serif text-sm text-foreground/50 tracking-[0.1em]">
              每一个词，都值得被拾起
            </p>
            <div className="w-10 h-px bg-border" />
          </div>
          <p className="text-[11px] text-muted-foreground/40 italic tracking-[0.06em]">
            Glean the beauty of every word.
          </p>
        </div>
      </div>
    );
  }

  if (isSearching) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-muted-foreground">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">查询中...</span>
      </div>
    );
  }

  const handlePanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const viewport = (e.currentTarget as HTMLElement)
      .querySelector("[data-radix-scroll-area-viewport]") as HTMLElement | null;
    if (viewport) viewport.scrollBy({ top: e.key === "ArrowDown" ? 80 : -80, behavior: "smooth" });
  };

  return (
    <div id="dict-panel" tabIndex={0} onKeyDown={handlePanelKeyDown} className="flex-1 flex flex-col min-w-0 outline-none">
      {/* Word header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0 gap-3">
        {/* Left: word + pronunciation */}
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-xl font-dict font-semibold truncate">{selectedWord}</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={handlePlay}
            className={cn("h-7 w-7 shrink-0", playingAudio && "text-primary")}
            title="发音"
          >
            <Volume2 size={15} />
          </Button>
        </div>

        {/* Right: tag area | separator | collect */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Tag chips + tag button */}
          <div className="relative flex items-center gap-1">
            {(() => {
              const selected = allTags.filter(t => activeTagIds.has(t.id));
              const visible = selected.slice(0, 2);
              const overflow = selected.length - 2;
              return (
                <>
                  {visible.map(tag => (
                    <span
                      key={tag.id}
                      className="text-[11px] font-medium px-1.5 py-0.5 rounded-full cursor-pointer select-none"
                      style={{ backgroundColor: tag.color + "33", color: tag.color, border: `1px solid ${tag.color}99` }}
                      onClick={() => setShowTagPanel(v => !v)}
                    >
                      {tag.name}
                    </span>
                  ))}
                  {overflow > 0 && (
                    <span
                      className="text-[11px] text-muted-foreground cursor-pointer select-none"
                      onClick={() => setShowTagPanel(v => !v)}
                    >
                      +{overflow}
                    </span>
                  )}
                </>
              );
            })()}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowTagPanel(v => !v)}
              className={cn("h-7 w-7 shrink-0", activeTagIds.size > 0 ? "text-foreground" : "text-muted-foreground")}
              title="选择标签"
            >
              <TagIcon size={14} />
            </Button>

            {showTagPanel && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowTagPanel(false)} />
                <div className="absolute right-0 top-full mt-1 bg-background border border-border rounded-lg shadow-md py-1 z-50 w-max min-w-[140px] max-w-[220px]">
                  {allTags.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">暂无标签</p>
                  ) : allTags.map(tag => {
                    const checked = activeTagIds.has(tag.id);
                    return (
                      <button
                        key={tag.id}
                        onClick={() => handleTagToggle(tag.id)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors"
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                        <span className="flex-1 text-left truncate">{tag.name}</span>
                        {tag.is_default && (
                          <span className={cn("text-[10px]", checked ? "text-muted-foreground/40" : "text-muted-foreground/40")}>默认</span>
                        )}
                        {checked && (
                          <span className="text-primary text-[10px] font-medium ml-1">✓</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <Separator orientation="vertical" className="h-4" />

          {/* Collect button — original position */}
          <Button
            variant={inVocab ? "secondary" : "outline"}
            size="sm"
            onClick={handleVocabToggle}
            disabled={vocabLoading}
            className="gap-1.5 text-xs h-7"
          >
            {vocabLoading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : inVocab ? (
              <BookmarkCheck size={13} />
            ) : (
              <BookmarkPlus size={13} />
            )}
            {inVocab ? "已收藏" : "收藏"}
          </Button>
        </div>
      </div>

      {/* Dict results */}
      <ScrollArea className="flex-1">
        {dictResults.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <p className="text-sm">未在已启用词典中找到 "{selectedWord}"</p>
            <p className="text-xs mt-1 opacity-60">请检查词典是否已正确导入</p>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-0">
            {dictResults.map((result, idx) => {
              const isCollapsed = collapsed.has(result.dict_id);
              return (
                <div key={`${result.dict_id}-${idx}`} id={`dict-section-${result.dict_id}`}>
                  {/* Dict header */}
                  <button
                    className="flex items-center gap-2 py-2.5 w-full text-left group"
                    onClick={() => toggleCollapse(result.dict_id)}
                  >
                    {isCollapsed
                      ? <ChevronRight size={12} className="text-muted-foreground shrink-0" />
                      : <ChevronDown size={12} className="text-muted-foreground shrink-0" />
                    }
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider shrink-0 group-hover:text-foreground transition-colors">
                      {result.dict_name}
                    </span>
                    <Separator className="flex-1" />
                  </button>

                  {!isCollapsed && (
                    <DictContent html={result.definition} css={result.css} dictId={result.dict_id} />
                  )}

                  {idx < dictResults.length - 1 && (
                    <div className="h-4" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function rewriteUrls(content: string, dictId: string): string {
  const base = `mdd://${dictId}/`;
  const isRelative = (u: string) =>
    !!u && !u.startsWith("http") && !u.startsWith("data:") &&
    !u.startsWith("mdd:") && !u.startsWith("#") && !u.startsWith("sound:");

  // Rewrite url(...) inside <style> blocks
  content = content.replace(
    /(<style[\s\S]*?>)([\s\S]*?)(<\/style>)/gi,
    (_m, open, body, close) => {
      const rewritten = body.replace(
        /url\((['"]?)([^'")]+)\1\)/g,
        (_u: string, q: string, u: string) =>
          isRelative(u) ? `url(${q}${base}${u}${q})` : _u
      );
      return `${open}${rewritten}${close}`;
    }
  );

  // Rewrite src="..." on <img> and <source>
  content = content.replace(
    /(<(?:img|source)\b[^>]*?\ssrc=)(["'])([^"']+)\2/gi,
    (m, pre, q, src) => isRelative(src) ? `${pre}${q}${base}${src}${q}` : m
  );

  return content;
}

function DictContent({ html, css, dictId }: { html: string; css?: string; dictId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });

    // Rewrite resource URLs before injection so browser loads them correctly
    const raw = css ? `<style>${css}</style>${html}` : html;
    shadow.innerHTML = rewriteUrls(raw, dictId);

    const handleClick = (e: Event) => {
      const a = (e.target as Element).closest("a");
      if (!a) return;
      const href = a.getAttribute("href") ?? "";
      if (href.startsWith("sound://")) {
        e.preventDefault();
        e.stopPropagation();
        playMddAudio(href.slice("sound://".length)).catch(console.error);
      } else if (href && !href.startsWith("#")) {
        e.preventDefault();
      }
    };

    shadow.addEventListener("click", handleClick);
    return () => shadow.removeEventListener("click", handleClick);
  }, [html, css, dictId]);

  // transform creates a new containing block for position:fixed descendants,
  // preventing them from escaping the scroll container.
  return <div ref={hostRef} className="dict-content pb-2" style={{ transform: "translateZ(0)" }} />;
}
