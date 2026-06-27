import { create } from "zustand";
import type { Dictionary, DictResult, VocabularyItem, Tag, Page } from "@/types";

interface AppState {
  // Navigation
  currentPage: Page;
  setCurrentPage: (page: Page) => void;

  // Dict loading state
  dictsReady: boolean;
  setDictsReady: (v: boolean) => void;

  // Search
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  candidates: string[];
  setCandidates: (words: string[]) => void;
  highlightedIndex: number;
  setHighlightedIndex: (i: number) => void;
  selectedWord: string | null;
  setSelectedWord: (word: string | null) => void;
  dictResults: DictResult[];
  setDictResults: (results: DictResult[]) => void;
  isSearching: boolean;
  setIsSearching: (v: boolean) => void;

  // Dictionaries
  dictionaries: Dictionary[];
  setDictionaries: (dicts: Dictionary[]) => void;
  dictIcons: Record<string, string>;
  setDictIcons: (icons: Record<string, string>) => void;

  // Settings
  onlineLookupEnabled: boolean;
  setOnlineLookupEnabled: (v: boolean) => void;
  aiEnabled: boolean;
  setAiEnabled: (v: boolean) => void;

  // Vocabulary
  vocabulary: VocabularyItem[];
  setVocabulary: (items: VocabularyItem[]) => void;
  selectedTagId: number | null;
  setSelectedTagId: (id: number | null) => void;

  // Tags
  tags: Tag[];
  setTags: (tags: Tag[]) => void;

}

export const useAppStore = create<AppState>((set) => ({
  currentPage: "search",
  setCurrentPage: (page) => set({ currentPage: page }),

  dictsReady: false,
  setDictsReady: (v) => set({ dictsReady: v }),

  searchQuery: "",
  setSearchQuery: (q) => set({ searchQuery: q }),
  candidates: [],
  setCandidates: (words) => set({ candidates: words, highlightedIndex: -1 }),
  highlightedIndex: -1,
  setHighlightedIndex: (i) => set({ highlightedIndex: i }),
  selectedWord: null,
  setSelectedWord: (word) => set({ selectedWord: word }),
  dictResults: [],
  setDictResults: (results) => set({ dictResults: results }),
  isSearching: false,
  setIsSearching: (v) => set({ isSearching: v }),

  dictionaries: [],
  setDictionaries: (dicts) => set({ dictionaries: dicts }),
  dictIcons: {},
  setDictIcons: (icons) => set({ dictIcons: icons }),

  onlineLookupEnabled: false,
  setOnlineLookupEnabled: (v) => set({ onlineLookupEnabled: v }),
  aiEnabled: false,
  setAiEnabled: (v) => set({ aiEnabled: v }),

  vocabulary: [],
  setVocabulary: (items) => set({ vocabulary: items }),
  selectedTagId: null,
  setSelectedTagId: (id) => set({ selectedTagId: id }),

  tags: [],
  setTags: (tags) => set({ tags }),
}));
