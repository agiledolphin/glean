import { useEffect, useState } from "react";
import { TrendingUp, Hash } from "lucide-react";
import { getWordStats, getQueryTrend, addToVocabulary } from "@/lib/commands";
import { useAppStore } from "@/store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import type { WordStats } from "@/types";

export function StatsPage() {
  const [topWords, setTopWords] = useState<WordStats[]>([]);
  const [trend, setTrend] = useState<{ date: string; count: number }[]>([]);
  const [trendDays, setTrendDays] = useState(7);
  const { setCurrentPage, setSearchQuery, setSelectedWord } = useAppStore();

  useEffect(() => {
    getWordStats(20).then(setTopWords).catch(() => {});
    getQueryTrend(trendDays).then(setTrend).catch(() => {});
  }, [trendDays]);

  const totalQueries = topWords.reduce((s, w) => s + w.query_count, 0);

  const handleWordClick = (word: string) => {
    setSearchQuery(word);
    setSelectedWord(word);
    setCurrentPage("search");
  };

  return (
    <ScrollArea className="flex-1">
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-8">

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Hash size={14} />
              <span className="text-xs">总查询次数</span>
            </div>
            <p className="text-2xl font-semibold">{totalQueries}</p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp size={14} />
              <span className="text-xs">查询词汇数</span>
            </div>
            <p className="text-2xl font-semibold">{topWords.length}</p>
          </div>
        </div>

        {/* Trend chart */}
        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium">查询趋势</h3>
            <div className="flex gap-1">
              {[7, 30].map((d) => (
                <Button
                  key={d}
                  variant={trendDays === d ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setTrendDays(d)}
                  className="h-6 px-2 text-xs"
                >
                  {d === 7 ? "近7天" : "近30天"}
                </Button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={trend} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "6px",
                  fontSize: "12px",
                }}
                cursor={{ fill: "hsl(var(--accent))" }}
              />
              <Bar dataKey="count" fill="#4385be" radius={[3, 3, 0, 0]} name="查询次数" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top words */}
        <div className="rounded-lg border border-border">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-medium">高频词 Top 20</h3>
          </div>
          <ul className="divide-y divide-border">
            {topWords.map((item, idx) => (
              <li key={item.word} className="flex items-center px-4 py-2 group">
                <span className="w-6 text-xs text-muted-foreground shrink-0">{idx + 1}</span>
                <button
                  onClick={() => handleWordClick(item.word)}
                  className="flex-1 text-sm font-dict text-left hover:text-primary transition-colors"
                >
                  {item.word}
                </button>
                <span className="text-xs text-muted-foreground mr-3">{item.query_count}次</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={async () => {
                    await addToVocabulary(item.word).catch(() => {});
                  }}
                >
                  收藏
                </Button>
              </li>
            ))}
            {topWords.length === 0 && (
              <li className="flex items-center justify-center h-20 text-muted-foreground text-sm">
                暂无查询记录
              </li>
            )}
          </ul>
        </div>
      </div>
    </ScrollArea>
  );
}
