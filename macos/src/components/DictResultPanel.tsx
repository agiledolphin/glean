import { useState, useEffect, useRef } from "react";
import { open } from "@tauri-apps/plugin-shell";
import appIcon from "@/assets/app-icon.png";
import { BookmarkPlus, BookmarkCheck, Volume2, Loader2, ChevronDown, ChevronRight, Tag as TagIcon, Sparkles, Save, Check } from "lucide-react";
import { useAppStore } from "@/store";
import { addToVocabulary, removeFromVocabulary, isInVocabulary, getVocabularyTags, playPronunciation, playMddAudio, listTags, addTagToWord, removeTagFromWord, askAi, getAiExplanation, saveAiExplanation } from "@/lib/commands";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { Tag } from "@/types";

export function DictResultPanel() {
  const { selectedWord, dictResults, isSearching, aiEnabled } = useAppStore();
  const [inVocab, setInVocab] = useState(false);
  const [vocabLoading, setVocabLoading] = useState(false);
  const [playingAudio, setPlayingAudio] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [activeTagIds, setActiveTagIds] = useState<Set<number>>(new Set());
  const [showTagPanel, setShowTagPanel] = useState(false);
  const [aiHtml, setAiHtml] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiCollapsed, setAiCollapsed] = useState(false);
  const [aiSaved, setAiSaved] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const aiRequestWordRef = useRef<string | null>(null);

  // Load tags once on mount
  useEffect(() => {
    listTags().then(tags => setAllTags(tags)).catch(() => {});
  }, []);

  // Invalidate in-flight AI request on unmount
  useEffect(() => {
    return () => { aiRequestWordRef.current = null; };
  }, []);

  // Reset state when the word changes; also invalidates any in-flight AI request.
  // If a saved explanation exists for the new word, load it straight in.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    aiRequestWordRef.current = null;
    setCollapsed(new Set());
    setAiHtml(null);
    setAiError(null);
    setAiLoading(false);
    setAiCollapsed(false);
    setAiSaved(false);

    if (!selectedWord) return;
    const thisWord = selectedWord;
    aiRequestWordRef.current = thisWord;
    getAiExplanation(thisWord).then(html => {
      if (aiRequestWordRef.current !== thisWord) return;
      if (html) {
        setAiHtml(html);
        setAiSaved(true);
      }
    }).catch(() => {});
  }, [selectedWord]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleAsk = async () => {
    if (!selectedWord) return;
    const thisWord = selectedWord;
    aiRequestWordRef.current = thisWord;
    setAiLoading(true);
    setAiError(null);
    setAiHtml(null);
    setAiSaved(false);
    setAiCollapsed(false);
    try {
      const html = await askAi(thisWord);
      if (aiRequestWordRef.current !== thisWord) return;
      setAiHtml(html);
    } catch (e) {
      if (aiRequestWordRef.current !== thisWord) return;
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      if (aiRequestWordRef.current === thisWord) setAiLoading(false);
    }
  };

  const handleSaveAi = async () => {
    if (!selectedWord || !aiHtml || aiSaving) return;
    setAiSaving(true);
    try {
      await saveAiExplanation(selectedWord, aiHtml);
      setAiSaved(true);
    } catch (e) {
      console.error(e);
    } finally {
      setAiSaving(false);
    }
  };

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
        await addToVocabulary(selectedWord, tagArr[0] ?? null);
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
        <img src={appIcon} alt="Glean" className="w-24 h-24 object-contain" style={{ mixBlendMode: "multiply" }} />
        <div className="flex flex-col items-center gap-2.5">
          <div className="flex items-center gap-4">
            <div className="w-10 h-px bg-border" />
            <p className="font-wenkai text-sm text-foreground/50 tracking-[0.1em]">
              每一个词，都值得被拾起
            </p>
            <div className="w-10 h-px bg-border" />
          </div>
          <p className="font-display text-sm italic text-muted-foreground/40 tracking-[0.06em]">
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

  // Keep focus in the search input when clicking toolbar buttons, so typing
  // resumes immediately without needing "/" or a manual click back into it.
  const preventFocusSteal = (e: React.MouseEvent) => e.preventDefault();

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
            onMouseDown={preventFocusSteal}
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
              onMouseDown={preventFocusSteal}
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
            onMouseDown={preventFocusSteal}
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
        <div className="px-5 py-4 space-y-0">
          {/* AI explanation section — always shown when enabled */}
          {aiEnabled && (
            <div className="mb-2">
              <div className="flex items-center gap-2 py-2.5 w-full">
                {aiHtml ? (
                  <button className="flex items-center gap-2 group" onClick={() => setAiCollapsed(v => !v)}>
                    {aiCollapsed
                      ? <ChevronRight size={12} className="text-muted-foreground shrink-0" />
                      : <ChevronDown size={12} className="text-muted-foreground shrink-0" />}
                  </button>
                ) : <span className="w-3" />}
                <Sparkles size={12} className="text-muted-foreground shrink-0" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider shrink-0">
                  AI 解释
                </span>
                <Separator className="flex-1" />
                {!aiHtml && !aiLoading && (
                  <button
                    onClick={handleAsk}
                    className="text-xs text-primary hover:text-primary/80 transition-colors shrink-0 ml-2"
                  >
                    生成
                  </button>
                )}
                {aiLoading && <Loader2 size={12} className="animate-spin text-muted-foreground shrink-0 ml-2" />}
                {aiHtml && !aiLoading && (
                  <button
                    onClick={handleAsk}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0 ml-2"
                  >
                    重新生成
                  </button>
                )}
                {aiHtml && !aiLoading && (
                  aiSaved ? (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0 ml-2" title="已保存，下次查询会直接显示">
                      <Check size={12} />
                      已保存
                    </span>
                  ) : (
                    <button
                      onClick={handleSaveAi}
                      disabled={aiSaving}
                      className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors shrink-0 ml-2 disabled:opacity-50"
                      title="保存后下次查询会直接显示，不用重新生成"
                    >
                      {aiSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                      保存
                    </button>
                  )
                )}
              </div>
              {aiError && (
                <p className="text-xs text-destructive px-1 pb-2">{aiError}</p>
              )}
              {aiHtml && !aiCollapsed && (
                <DictContent html={aiHtml} dictId="ai" />
              )}
              <div className="h-4" />
            </div>
          )}

          {dictResults.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <p className="text-sm">未在已启用词典中找到 "{selectedWord}"</p>
              <p className="text-xs mt-1 opacity-60">请检查词典是否已正确导入</p>
            </div>
          ) : (
            dictResults.map((result, idx) => {
              const isCollapsed = collapsed.has(result.dict_id);
              return (
                <div key={`${result.dict_id}-${idx}`} id={`dict-section-${result.dict_id}`}>
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
                    <DictContent html={result.definition} css={result.css} js={result.js} dictId={result.dict_id} />
                  )}

                  {idx < dictResults.length - 1 && (
                    <div className="h-4" />
                  )}
                </div>
              );
            })
          )}
        </div>
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

// MDX cross-reference links are typically bare relative hrefs (e.g. href="greeting"),
// sometimes prefixed with a custom scheme (e.g. "entry://greeting"). Strip any scheme
// and fragment/query so the remainder can be looked up as a headword.
function extractEntryWord(href: string): string {
  let w = href.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:(\/\/)?/, "");
  w = w.split("#")[0].split("?")[0];
  try { w = decodeURIComponent(w); } catch { /* leave as-is if malformed */ }
  return w.trim();
}

// Dict-provided interactive widgets (e.g. Oxford's "+ More About" panels) rely on
// inline onclick="someGlobalFn(this)" attributes. Shadow DOM only isolates CSS/DOM
// queries, not JS scope — but `shadow.innerHTML = ...` never executes embedded
// <script> tags at all. So each dict's companion .js is injected once as a real
// <script> element on the document, making its functions reachable from onclick
// handlers on elements living inside any Shadow DOM.
const injectedDictScripts = new Set<string>();

function injectDictScript(dictId: string, js: string) {
  if (injectedDictScripts.has(dictId)) return;
  injectedDictScripts.add(dictId);
  const script = document.createElement("script");
  script.textContent = js;
  script.dataset.dictScript = dictId;
  document.head.appendChild(script);
}

function DictContent({ html, css, js, dictId }: { html: string; css?: string; js?: string; dictId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (js) injectDictScript(dictId, js);

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
      } else if (href.startsWith("http://") || href.startsWith("https://")) {
        e.preventDefault();
        open(href).catch(console.error);
      } else if (href && !href.startsWith("#")) {
        e.preventDefault();
        const word = extractEntryWord(href);
        if (word) useAppStore.getState().setSelectedWord(word);
      }
    };

    shadow.addEventListener("click", handleClick);
    return () => shadow.removeEventListener("click", handleClick);
  }, [html, css, js, dictId]);

  // transform creates a new containing block for position:fixed descendants,
  // preventing them from escaping the scroll container.
  return <div ref={hostRef} className="dict-content pb-2" style={{ transform: "translateZ(0)" }} />;
}
