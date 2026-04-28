import { useEffect } from "react";
import { useAppStore } from "@/store";
import { Navbar } from "@/components/Navbar";
import { SearchPage } from "@/pages/SearchPage";
import { VocabularyPage } from "@/pages/VocabularyPage";
import { StatsPage } from "@/pages/StatsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { listDictionaries } from "@/lib/commands";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function App() {
  const { currentPage, setDictionaries } = useAppStore();

  useEffect(() => {
    listDictionaries().then(setDictionaries).catch(() => {});
  }, []);

  // Tab cycles only between the 3 focus zones
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const zones = ["search-input", "candidate-list", "dict-panel"]
        .map(id => document.getElementById(id))
        .filter(Boolean) as HTMLElement[];
      const active = document.activeElement;
      const idx = zones.findIndex(z => z === active || z.contains(active));
      e.preventDefault();
      const next = e.shiftKey
        ? (idx <= 0 ? zones.length - 1 : idx - 1)
        : (idx >= zones.length - 1 ? 0 : idx + 1);
      zones[next]?.focus();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen overflow-hidden">
        <Navbar />
        <main className="flex flex-1 min-h-0">
          {currentPage === "search" && <SearchPage />}
          {currentPage === "vocabulary" && <VocabularyPage />}
          {currentPage === "stats" && <StatsPage />}
          {currentPage === "settings" && <SettingsPage />}
        </main>
      </div>
    </TooltipProvider>
  );
}
