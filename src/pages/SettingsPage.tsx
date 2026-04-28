import { useEffect, useState, useRef } from "react";
import { Plus, GripVertical, Trash2, Eye, EyeOff } from "lucide-react";
import { useAppStore } from "@/store";
import {
  listDictionaries, importDictionary,
  toggleDictionary, removeDictionary, updateDictionaryOrder,
} from "@/lib/commands";
import { open } from "@tauri-apps/plugin-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/types";

export function SettingsPage() {
  const { dictionaries, setDictionaries } = useAppStore();
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);
  const dragIdx = useRef<number | null>(null);

  const loadDicts = () => listDictionaries().then(setDictionaries).catch(() => {});

  useEffect(() => { loadDicts(); }, []);

  const handleImport = async () => {
    setImportError(null);
    setDebugInfo(null);
    let lastFilePath: string | null = null;
    try {
      setImporting(true);
      const file = await open({
        directory: true,
        multiple: false,
      });
      // Tauri 2 returns string | string[] | null
      lastFilePath = Array.isArray(file) ? (file[0] ?? null) : file;
      if (lastFilePath) {
        await importDictionary(lastFilePath);
        loadDicts();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setImportError(msg);
      console.error("Import failed:", e);
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

  const handleDragStart = (idx: number) => { dragIdx.current = idx; };
  const handleDrop = async (targetIdx: number) => {
    if (dragIdx.current === null || dragIdx.current === targetIdx) return;
    const reordered = [...dictionaries];
    const [moved] = reordered.splice(dragIdx.current, 1);
    reordered.splice(targetIdx, 0, moved);
    for (let i = 0; i < reordered.length; i++) {
      await updateDictionaryOrder(reordered[i].id, i).catch(() => {});
    }
    loadDicts();
    dragIdx.current = null;
  };

  return (
    <ScrollArea className="flex-1">
      <div className="max-w-xl mx-auto px-6 py-6 space-y-8">

        {/* Dictionary section */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-medium">词典管理</h2>
              <p className="text-xs text-muted-foreground mt-0.5">拖拽可调整词典显示顺序</p>
            </div>
            <Button
              size="sm"
              className="gap-1.5 text-xs h-8"
              onClick={handleImport}
              disabled={importing}
            >
              <Plus size={13} />
              {importing ? "导入中..." : "导入词典"}
            </Button>
          </div>

          {importError && (
            <div className="mb-3 rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive space-y-1">
              <p><span className="font-medium">导入失败：</span>{importError}</p>
              {debugInfo && (
                <pre className="mt-2 text-[10px] leading-relaxed text-foreground/70 whitespace-pre-wrap break-all bg-muted/40 rounded p-2 max-h-48 overflow-auto">
                  {debugInfo}
                </pre>
              )}
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
            <ul className="space-y-1.5">
              {dictionaries.map((dict, idx) => (
                <li
                  key={dict.id}
                  draggable
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDrop(idx)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border border-border p-3",
                    "hover:border-primary/40 transition-colors cursor-grab active:cursor-grabbing",
                    !dict.enabled && "opacity-50"
                  )}
                >
                  <GripVertical size={14} className="text-muted-foreground shrink-0" />

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{dict.name}</p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {dict.file_path.split("/").pop()}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleToggle(dict)}
                      title={dict.enabled ? "禁用" : "启用"}
                    >
                      {dict.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemove(dict.id)}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Separator />

        {/* About */}
        <section>
          <h2 className="text-base font-medium mb-4">关于</h2>
          <div className="rounded-lg border border-border p-4 text-center">
            <p className="text-lg font-serif text-foreground">🌿 拾词 · Glean</p>
            <p className="text-xs text-muted-foreground mt-1">v0.1.0</p>
            <p className="text-xs text-muted-foreground mt-3 italic">
              "每一词，都值得被拾起。"
            </p>
          </div>
        </section>

      </div>
    </ScrollArea>
  );
}
