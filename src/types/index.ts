export interface Dictionary {
  id: string;
  name: string;
  file_path: string;
  enabled: boolean;
  sort_order: number;
  added_at: string;
}

export interface DictEntry {
  word: string;
  definition: string; // HTML content from dictionary
}

export interface DictResult {
  dict_id: string;
  dict_name: string;
  word: string;
  definition: string;
  css?: string;
}

export interface VocabularyItem {
  id: number;
  word: string;
  note: string | null;
  starred: boolean;
  created_at: string;
  updated_at: string;
  tags: Tag[];
}

export interface Tag {
  id: number;
  name: string;
  color: string;
  is_default: boolean;
}

export interface WordStats {
  word: string;
  query_count: number;
  first_seen: string;
  last_seen: string;
}

export interface QueryHistory {
  id: number;
  word: string;
  dict_id: string | null;
  queried_at: string;
}

export type SortOrder = "alpha" | "created_at" | "query_count" | "updated_at";
export type ViewMode = "list" | "grid";
export type Page = "search" | "vocabulary" | "stats" | "settings";
