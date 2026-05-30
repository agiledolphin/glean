import { useEffect, useState, useCallback } from "react";
import { RotateCcw, ArrowRight, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DictResultPanel } from "@/components/DictResultPanel";
import { getReviewSession, submitReview, getReviewStats, lookupWord } from "@/lib/commands";
import { useAppStore } from "@/store";

import { cn } from "@/lib/utils";
import type { ReviewCard, ReviewStats } from "@/types";

const SCORE_LABELS: { score: number; label: string; color: string }[] = [
  { score: 0, label: "完全不记得", color: "border-destructive/60 text-destructive hover:bg-destructive/10" },
  { score: 1, label: "模糊",       color: "border-orange-400/60 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/20" },
  { score: 2, label: "认识",       color: "border-blue-400/60 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/20" },
  { score: 3, label: "很熟",       color: "border-green-500/60 text-green-700 hover:bg-green-50 dark:hover:bg-green-950/20" },
];

type Phase = "idle" | "reviewing" | "done";

export function ReviewPage() {
  const { dictsReady, dictResults, setDictResults, setSelectedWord } = useAppStore();
  const [phase, setPhase] = useState<Phase>("idle");
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loadingDict, setLoadingDict] = useState(false);
  const [sessionResults, setSessionResults] = useState<{ word: string; score: number }[]>([]);

  const loadStats = useCallback(() => {
    getReviewStats().then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const startSession = async () => {
    const session = await getReviewSession();
    if (session.length === 0) return;
    setCards(session);
    setIndex(0);
    setFlipped(false);
    setSelectedWord(null);
    setDictResults([]);  // clear store
    setSessionResults([]);
    setPhase("reviewing");
  };

  const handleFlip = async () => {
    if (flipped) return;
    setFlipped(true);
    const word = cards[index].word;
    setSelectedWord(word);
    setLoadingDict(true);
    try {
      const results = await lookupWord(word);
      setDictResults(results);  // push into store for DictResultPanel
    } catch {
      setDictResults([]);
    } finally {
      setLoadingDict(false);
    }
  };

  const handleScore = async (score: number) => {
    const word = cards[index].word;
    await submitReview(word, score).catch(() => {});
    const updated = [...sessionResults, { word, score }];
    setSessionResults(updated);

    if (index + 1 >= cards.length) {
      setPhase("done");
      loadStats();
    } else {
      setIndex(i => i + 1);
      setFlipped(false);
      setSelectedWord(null);
      setDictResults([]);  // clear store
    }
  };

  // Keyboard shortcuts during review
  useEffect(() => {
    if (phase !== "reviewing") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        if (!flipped) { e.preventDefault(); handleFlip(); }
      } else if (flipped && ["1", "2", "3", "4"].includes(e.key)) {
        handleScore(Number(e.key) - 1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, flipped, index]);

  // ── Idle / Stats screen ──────────────────────────────────────────────
  if (phase === "idle") {
    const dueCount = (stats?.due_today ?? 0) + (stats?.new_words ?? 0);
    const sessionSize = Math.min(dueCount, 20);
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-8 px-8">
        <div className="flex flex-col items-center gap-2">
          <BookOpen size={40} className="text-muted-foreground/50" />
          <h2 className="font-serif text-2xl text-foreground">背单词</h2>
        </div>

        {stats && (
          <div className="grid grid-cols-2 gap-3 w-full max-w-xs text-sm">
            <StatBox label="待复习" value={stats.due_today} accent />
            <StatBox label="新单词" value={stats.new_words} />
            <StatBox label="已复习" value={stats.total_reviewed} />
            <StatBox label="生词本总量" value={stats.total_in_vocab} />
          </div>
        )}

        <div className="flex flex-col items-center gap-2">
          <Button
            onClick={startSession}
            disabled={!dictsReady || sessionSize === 0}
            className="px-8 h-10 gap-2"
          >
            开始本次学习
            {sessionSize > 0 && <span className="opacity-70 text-xs">({sessionSize} 词)</span>}
          </Button>
          {sessionSize === 0 && (
            <p className="text-xs text-muted-foreground">生词本为空，先去查词收录单词吧</p>
          )}
        </div>
      </div>
    );
  }

  // ── Done screen ──────────────────────────────────────────────────────
  if (phase === "done") {
    const counts = [0, 1, 2, 3].map(s => sessionResults.filter(r => r.score === s).length);
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-8 px-8">
        <h2 className="font-serif text-2xl text-foreground">本次复习完成</h2>
        <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
          {SCORE_LABELS.map(({ label }, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3 rounded-lg bg-muted/50 text-sm">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium">{counts[i]}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => { setPhase("idle"); loadStats(); }} className="gap-2">
            <RotateCcw size={14} />
            返回
          </Button>
          <Button onClick={startSession} className="gap-2">
            再来一组
            <ArrowRight size={14} />
          </Button>
        </div>
      </div>
    );
  }

  // ── Review card ──────────────────────────────────────────────────────
  const card = cards[index];
  const progress = index / cards.length;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Progress bar */}
      <div className="h-0.5 bg-muted shrink-0">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="flex flex-col flex-1 min-h-0 px-8 py-6 gap-4">
        {/* Counter */}
        <div className="flex items-center justify-between text-xs text-muted-foreground shrink-0">
          <span>{index + 1} / {cards.length}</span>
          {card.due_today
            ? <span className="text-primary/70">待复习</span>
            : <span className="text-muted-foreground/60">新词</span>
          }
        </div>

        {/* Card area */}
        <div
          className={cn(
            "flex flex-col flex-1 min-h-0 rounded-xl border border-border bg-card transition-all",
            !flipped && "cursor-pointer hover:border-primary/40 hover:shadow-sm"
          )}
          onClick={!flipped ? handleFlip : undefined}
        >
          {/* Word */}
          <div className={cn(
            "flex items-center justify-center shrink-0 transition-all",
            flipped ? "py-4 border-b border-border" : "flex-1"
          )}>
            <span className={cn(
              "font-display tracking-wide text-foreground transition-all",
              flipped ? "text-2xl" : "text-4xl"
            )}>
              {card.word}
            </span>
          </div>

          {/* Dict result */}
          {flipped && (
            <div className="flex-1 min-h-0 overflow-auto">
              {loadingDict
                ? <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">加载中...</div>
                : dictResults.length > 0
                  ? <DictResultPanel />
                  : <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">未找到词典释义</div>
              }
            </div>
          )}

          {/* Flip hint */}
          {!flipped && (
            <div className="py-3 text-center text-xs text-muted-foreground/50 shrink-0">
              点击或按空格翻转
            </div>
          )}
        </div>

        {/* Rating buttons */}
        {flipped && (
          <div className="grid grid-cols-4 gap-2 shrink-0">
            {SCORE_LABELS.map(({ score, label, color }) => (
              <button
                key={score}
                onClick={() => handleScore(score)}
                className={cn(
                  "py-2 text-xs font-medium rounded-lg border transition-colors",
                  color
                )}
              >
                <span className="block text-[10px] opacity-50 mb-0.5">{score + 1}</span>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={cn(
      "flex flex-col items-center gap-1 px-4 py-3 rounded-lg text-sm",
      accent ? "bg-primary/10 text-primary" : "bg-muted/50 text-muted-foreground"
    )}>
      <span className="text-xl font-medium text-foreground">{value}</span>
      <span>{label}</span>
    </div>
  );
}
