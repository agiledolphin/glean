import { invoke } from "@tauri-apps/api/core";
import type { Dictionary, DictResult, VocabularyItem, Tag, WordStats } from "@/types";

// --- Dictionary commands ---
export const areDictsReady = () =>
  invoke<boolean>("are_dicts_ready");

export const importDictionary = (dirPath: string) =>
  invoke<Dictionary>("import_dictionary", { dirPath });

export const listDictionaries = () =>
  invoke<Dictionary[]>("list_dictionaries");

export const updateDictionaryOrder = (id: string, sortOrder: number) =>
  invoke<void>("update_dictionary_order", { id, sortOrder });

export const toggleDictionary = (id: string, enabled: boolean) =>
  invoke<void>("toggle_dictionary", { id, enabled });

export const removeDictionary = (id: string) =>
  invoke<void>("remove_dictionary", { id });

// --- Search commands ---
export const searchCandidates = (prefix: string) =>
  invoke<string[]>("search_candidates", { prefix });

export const lookupWord = (word: string) =>
  invoke<DictResult[]>("lookup_word", { word });

export const getRecentHistory = (limit: number) =>
  invoke<string[]>("get_recent_history", { limit });

// --- Vocabulary commands ---
export const addToVocabulary = (word: string, tagId: number | null = null) =>
  invoke<VocabularyItem>("add_to_vocabulary", { word, tagId });

export const removeFromVocabulary = (word: string) =>
  invoke<void>("remove_from_vocabulary", { word });

export const isInVocabulary = (word: string) =>
  invoke<boolean>("is_in_vocabulary", { word });

export const getVocabularyTags = (word: string) =>
  invoke<Tag[]>("get_vocabulary_tags", { word });

export const countVocabulary = (tagId?: number, hasNote?: boolean) =>
  invoke<number>("count_vocabulary", { tagId: tagId ?? null, hasNote: hasNote ?? false });

export const listVocabulary = (tagId: number | null | undefined, limit: number, offset: number, hasNote: boolean = false) =>
  invoke<VocabularyItem[]>("list_vocabulary", { tagId: tagId ?? null, limit, offset, hasNote });

export const updateVocabularyNote = (word: string, note: string) =>
  invoke<void>("update_vocabulary_note", { word, note });

export const toggleStar = (word: string) =>
  invoke<void>("toggle_star", { word });

// --- Tag commands ---
export const listTags = () =>
  invoke<Tag[]>("list_tags");

export const createTag = (name: string, color: string) =>
  invoke<Tag>("create_tag", { name, color });

export const renameTag = (id: number, name: string) =>
  invoke<void>("rename_tag", { id, name });

export const deleteTag = (id: number) =>
  invoke<void>("delete_tag", { id });

export const setDefaultTag = (tagId: number | null) =>
  invoke<void>("set_default_tag", { tagId });

export const addTagToWord = (word: string, tagId: number) =>
  invoke<void>("add_tag_to_word", { word, tagId });

export const removeTagFromWord = (word: string, tagId: number) =>
  invoke<void>("remove_tag_from_word", { word, tagId });

// --- Stats commands ---
export const getWordStats = (limit: number) =>
  invoke<WordStats[]>("get_word_stats", { limit });

export const getQueryTrend = (days: number) =>
  invoke<{ date: string; count: number }[]>("get_query_trend", { days });

// --- Audio commands ---
export const playPronunciation = (word: string) =>
  invoke<void>("play_pronunciation", { word });

export const playMddAudio = (key: string) =>
  invoke<void>("play_mdd_audio", { key });

// --- Import commands ---
export const previewImportFile = (path: string, skipHeader: boolean) =>
  invoke<{ total: number; sample: string[] }>("preview_import_file", { path, skipHeader });

export const importVocabularyFromFile = (path: string, tagId: number | null, skipHeader: boolean) =>
  invoke<{ imported: number; tag_added: number; skipped: number }>("import_vocabulary_from_file", { path, tagId, skipHeader });

// --- Export commands ---
export const exportVocabulary = (tagId?: number) =>
  invoke<string>("export_vocabulary", { tagId: tagId ?? null });

export const getDictIcons = () =>
  invoke<Record<string, string>>("get_dict_icons");

export const debugMdxHeader = (filePath: string) =>
  invoke<string>("debug_mdx_header", { filePath });

export const debugMddKeys = (filter: string, limit: number) =>
  invoke<string[]>("debug_mdd_keys", { filter, limit });

export const debugDictCss = (chars: number) =>
  invoke<string[]>("debug_dict_css", { chars });
