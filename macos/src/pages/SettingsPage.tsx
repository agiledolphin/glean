import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { Plus, GripVertical, Trash2, Eye, EyeOff } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import appIcon from "@/assets/app-icon.png";
import { useAppStore } from "@/store";
import {
  listDictionaries, importDictionary,
  toggleDictionary, removeDictionary, updateDictionaryOrder,
  setSetting, getSetting,
} from "@/lib/commands";
import { open } from "@tauri-apps/plugin-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/types";

interface GhostState {
  dict: Dictionary;
  x: number;
  y: number;
  width: number;
  offsetX: number;
  offsetY: number;
}

export function SettingsPage() {
  const { dictionaries, setDictionaries, onlineLookupEnabled, setOnlineLookupEnabled, aiEnabled, setAiEnabled } = useAppStore();

  const handleOnlineToggle = async (enabled: boolean) => {
    setOnlineLookupEnabled(enabled);
    await setSetting("online_lookup_enabled", String(enabled));
  };

  // LLM settings
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);

  const PRESETS = [
    { label: "DeepSeek", url: "https://api.deepseek.com", model: "deepseek-v4-flash" },
    { label: "OpenAI", url: "https://api.openai.com/v1", model: "gpt-4o-mini" },
    { label: "Ollama", url: "http://localhost:11434/v1", model: "llama3" },
  ];

  useEffect(() => {
    Promise.all([
      getSetting("llm_base_url"),
      getSetting("llm_api_key"),
      getSetting("llm_model"),
    ]).then(([url, key, model]) => {
      setLlmBaseUrl(url ?? "https://api.deepseek.com");
      setLlmApiKey(key ?? "");
      setLlmModel(model ?? "deepseek-v4-flash");
    }).catch(() => {});
  }, []);

  const handleLlmSave = async () => {
    await Promise.all([
      setSetting("llm_base_url", llmBaseUrl.trim()),
      setSetting("llm_api_key", llmApiKey.trim()),
      setSetting("llm_model", llmModel.trim()),
    ]);
  };

  const handleAiToggle = async (enabled: boolean) => {
    setAiEnabled(enabled);
    await setSetting("llm_enabled", String(enabled));
  };
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}); }, []);

  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [insertAfterIdx, setInsertAfterIdx] = useState<number | null>(null);
  const [ghost, setGhost] = useState<GhostState | null>(null);

  const draggingRef = useRef<number | null>(null);
  const insertAfterRef = useRef<number | null>(null);
  const ghostRef = useRef<GhostState | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const loadDicts = () => listDictionaries().then(setDictionaries).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadDicts(); }, []);

  const handleImport = async () => {
    setImportError(null);
    try {
      setImporting(true);
      const file = await open({ directory: true, multiple: false });
      const path = Array.isArray(file) ? (file[0] ?? null) : file;
      if (path) { await importDictionary(path); loadDicts(); }
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const handleToggle = async (dict: Dictionary) => {
    await toggleDictionary(dict.id, !dict.enabled);
    loadDicts();
  };

  const handleRemove = async (id: string) => {
    await removeDictionary(id);
    loadDicts();
  };

  const handleGripMouseDown = useCallback((e: React.MouseEvent, idx: number) => {
    e.preventDefault();
    const snapshot = [...dictionaries];
    const dict = snapshot[idx];

    // Measure the li element for ghost sizing and grab offset
    const liEl = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-drag-idx]");
    const rect = liEl?.getBoundingClientRect();
    const width = rect?.width ?? 400;
    const offsetX = rect ? e.clientX - rect.left : 0;
    const offsetY = rect ? e.clientY - rect.top : 0;

    const initialGhost: GhostState = {
      dict,
      x: e.clientX - offsetX,
      y: e.clientY - offsetY,
      width,
      offsetX,
      offsetY,
    };
    ghostRef.current = initialGhost;
    draggingRef.current = idx;
    insertAfterRef.current = idx - 1;
    setDraggingIdx(idx);
    setInsertAfterIdx(idx - 1);
    setGhost(initialGhost);

    const onMouseMove = (ev: MouseEvent) => {
      // Update ghost position
      const next: GhostState = {
        ...ghostRef.current!,
        x: ev.clientX - ghostRef.current!.offsetX,
        y: ev.clientY - ghostRef.current!.offsetY,
      };
      ghostRef.current = next;
      setGhost({ ...next });

      // Update insertion indicator
      if (!listRef.current) return;
      const items = Array.from(
        listRef.current.querySelectorAll<HTMLElement>("[data-drag-idx]")
      );
      let after = items.length - 1;
      for (let i = 0; i < items.length; i++) {
        const r = items[i].getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) {
          after = i - 1;
          break;
        }
      }
      if (after !== insertAfterRef.current) {
        insertAfterRef.current = after;
        setInsertAfterIdx(after);
      }
    };

    const onMouseUp = async () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      const from = draggingRef.current;
      const after = insertAfterRef.current;
      draggingRef.current = null;
      insertAfterRef.current = null;
      ghostRef.current = null;
      setDraggingIdx(null);
      setInsertAfterIdx(null);
      setGhost(null);
      if (from === null || after === null) return;
      const to = after < from ? after + 1 : after;
      if (to === from) return;
      const reordered = [...snapshot];
      const [moved] = reordered.splice(from, 1);
      reordered.splice(to, 0, moved);
      setDictionaries(reordered);
      for (let i = 0; i < reordered.length; i++) {
        await updateDictionaryOrder(reordered[i].id, i).catch(() => {});
      }
      loadDicts();
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictionaries]);

  const linePosition = useMemo((): number | null => {
    if (draggingIdx === null || insertAfterIdx === null) return null;
    const to = insertAfterIdx < draggingIdx ? insertAfterIdx + 1 : insertAfterIdx;
    if (to === draggingIdx) return null;
    return to;
  }, [draggingIdx, insertAfterIdx]);

  return (
    <ScrollArea className="flex-1">
      <div className="max-w-xl mx-auto px-6 py-6 space-y-8">

        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-medium">词典管理</h2>
              <p className="text-xs text-muted-foreground mt-0.5">拖拽把手可调整词典显示顺序</p>
            </div>
            <Button size="sm" className="gap-1.5 text-xs h-8" onClick={handleImport} disabled={importing}>
              <Plus size={13} />
              {importing ? "导入中..." : "导入词典"}
            </Button>
          </div>

          {importError && (
            <div className="mb-3 rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive">
              <span className="font-medium">导入失败：</span>{importError}
            </div>
          )}

          {dictionaries.length === 0 ? (
            <div
              className="border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center h-32 cursor-pointer hover:border-primary transition-colors"
              onClick={handleImport}
            >
              <Plus size={24} className="text-muted-foreground mb-2" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">点击导入词典文件夹</p>
              <p className="text-xs text-muted-foreground mt-1 opacity-60">选择包含 .mdx 的目录</p>
            </div>
          ) : (
            <ul ref={listRef} className="select-none" style={{ userSelect: "none" }}>
              {dictionaries.map((dict, idx) => (
                <li key={dict.id} data-drag-idx={idx} className="relative">
                  {linePosition === idx && (
                    <div className="absolute -top-px left-0 right-0 h-0.5 bg-primary rounded-full z-10 pointer-events-none" />
                  )}
                  {linePosition === dictionaries.length && idx === dictionaries.length - 1 && (
                    <div className="absolute -bottom-px left-0 right-0 h-0.5 bg-primary rounded-full z-10 pointer-events-none" />
                  )}
                  <div className={cn(
                    "flex items-center gap-3 rounded-lg border border-border p-3 mb-1.5 transition-opacity duration-100",
                    draggingIdx === idx && "opacity-30",
                  )}>
                    <GripVertical
                      size={14}
                      className="text-muted-foreground shrink-0 cursor-grab hover:text-foreground transition-colors"
                      onMouseDown={(e) => handleGripMouseDown(e, idx)}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{dict.name}</p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {dict.file_path.split("/").pop()}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7"
                        onClick={() => handleToggle(dict)} title={dict.enabled ? "禁用" : "启用"}>
                        {dict.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                      </Button>
                      <Button variant="ghost" size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemove(dict.id)}>
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Separator />

        <section>
          <h2 className="text-base font-medium mb-1">在线查词</h2>
          <p className="text-xs text-muted-foreground mb-4">
            本地词典无结果时，自动通过 Free Dictionary API 在线查询（仅支持英语）
          </p>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Free Dictionary API</p>
              <p className="text-xs text-muted-foreground mt-0.5">dictionaryapi.dev · 免费 · 无需 API Key</p>
            </div>
            <button
              role="switch"
              aria-checked={onlineLookupEnabled}
              onClick={() => handleOnlineToggle(!onlineLookupEnabled)}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                onlineLookupEnabled ? "bg-primary" : "bg-input"
              )}
            >
              <span className={cn(
                "pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg transition-transform",
                onlineLookupEnabled ? "translate-x-4" : "translate-x-0"
              )} />
            </button>
          </div>
        </section>

        <Separator />

        <section>
          <div className="flex items-center justify-between mb-1">
            <div>
              <h2 className="text-base font-medium">AI 解释</h2>
              <p className="text-xs text-muted-foreground mt-0.5">在词典结果面板中显示 AI 解释按钮</p>
            </div>
            <button
              role="switch"
              aria-checked={aiEnabled}
              onClick={() => handleAiToggle(!aiEnabled)}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                aiEnabled ? "bg-primary" : "bg-input"
              )}
            >
              <span className={cn(
                "pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg transition-transform",
                aiEnabled ? "translate-x-4" : "translate-x-0"
              )} />
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {/* Presets */}
            <div className="flex gap-2">
              {PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => { setLlmBaseUrl(p.url); setLlmModel(p.model); }}
                  className={cn(
                    "text-xs px-2.5 py-1 rounded-md border transition-colors",
                    llmBaseUrl === p.url
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-foreground"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Base URL */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Base URL</label>
              <input
                type="text"
                value={llmBaseUrl}
                onChange={e => setLlmBaseUrl(e.target.value)}
                onBlur={handleLlmSave}
                placeholder="https://api.deepseek.com/v1"
                className="w-full text-sm px-3 py-1.5 rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* API Key */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">API Key</label>
              <div className="relative">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={llmApiKey}
                  onChange={e => setLlmApiKey(e.target.value)}
                  onBlur={handleLlmSave}
                  placeholder="sk-..."
                  className="w-full text-sm px-3 py-1.5 pr-9 rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  onClick={() => setShowApiKey(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showApiKey ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </div>

            {/* Model */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Model</label>
              <input
                type="text"
                value={llmModel}
                onChange={e => setLlmModel(e.target.value)}
                onBlur={handleLlmSave}
                placeholder="deepseek-chat"
                className="w-full text-sm px-3 py-1.5 rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
        </section>

        <Separator />

        <section>
          <h2 className="text-base font-medium mb-6">关于</h2>
          <div className="flex flex-col gap-6 py-2">
            {/* Icon + names row */}
            <div className="flex items-center justify-center gap-5">
              <img src={appIcon} alt="拾词" className="w-20 h-20 shrink-0 object-contain" style={{ mixBlendMode: "multiply" }} />
              <div className="flex flex-col gap-0.5 items-center">
                <p className="text-xl font-serif font-medium tracking-[0.06em] text-foreground leading-tight">拾词</p>
                <p className="font-display text-sm tracking-[0.3em] uppercase text-muted-foreground">Glean</p>
                {appVersion && (
                  <p className="text-[11px] text-muted-foreground/50 tracking-wider mt-1">v{appVersion}</p>
                )}
              </div>
            </div>

            {/* Slogans */}
            <div className="flex flex-col items-center gap-1.5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-px bg-border" />
                <p className="font-wenkai text-sm text-muted-foreground whitespace-nowrap tracking-[0.05em]">每一个词，都值得被拾起</p>
                <div className="w-8 h-px bg-border" />
              </div>
              <p className="font-display text-sm italic text-muted-foreground/60 tracking-[0.06em]">
                Glean the beauty of every word.
              </p>
            </div>
          </div>
        </section>

      </div>

      {/* Drag ghost — follows cursor */}
      {ghost && (
        <div
          className="fixed pointer-events-none z-50 rounded-lg border border-primary/40 bg-background/95 backdrop-blur-sm shadow-lg p-3 flex items-center gap-3"
          style={{
            left: ghost.x,
            top: ghost.y,
            width: ghost.width,
            transform: "rotate(1.5deg) scale(1.02)",
          }}
        >
          <GripVertical size={14} className="text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{ghost.dict.name}</p>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {ghost.dict.file_path.split("/").pop()}
            </p>
          </div>
        </div>
      )}
    </ScrollArea>
  );
}
