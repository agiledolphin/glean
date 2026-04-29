use crate::db::DB;
use anyhow::Result;
use rusqlite::params;
use serde::{Deserialize, Serialize};

// ─── Import types ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImportWord {
    pub word: String,
    pub note: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ImportPreview {
    pub total: usize,
    pub sample: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub imported: usize,
    pub tag_added: usize,
    pub skipped: usize,
}

fn split_csv_line(line: &str) -> Vec<String> {
    let mut result = vec![];
    let mut current = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '"' => {
                if in_quotes && chars.peek() == Some(&'"') {
                    current.push('"');
                    chars.next();
                } else {
                    in_quotes = !in_quotes;
                }
            }
            ',' if !in_quotes => { result.push(std::mem::take(&mut current)); }
            _ => current.push(ch),
        }
    }
    result.push(current);
    result
}

fn parse_import_content(path: &str, content: &str, skip_header: bool) -> Vec<ImportWord> {
    // Strip UTF-8 BOM if present
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);

    if path.to_lowercase().ends_with(".json") {
        let Ok(arr) = serde_json::from_str::<serde_json::Value>(content) else { return vec![]; };
        let Some(items) = arr.as_array() else { return vec![]; };
        return items.iter().filter_map(|item| {
            let word = item.get("word")?.as_str()?.trim().to_string();
            if word.is_empty() { return None; }
            Some(ImportWord {
                word,
                note: item.get("note").and_then(|v| v.as_str()).map(|s| s.to_string()).filter(|s| !s.is_empty()),
            })
        }).collect();
    }
    // CSV
    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.is_empty() { return vec![]; }

    // skip_header: unconditionally skip first line, treat rest as plain word list
    if skip_header {
        return lines[1..].iter().filter_map(|line| {
            let word = line.trim().trim_matches('"').to_string();
            if word.is_empty() { None } else { Some(ImportWord { word, note: None }) }
        }).collect();
    }

    let headers: Vec<String> = lines[0].split(',')
        .map(|h| h.trim().trim_matches('"').to_lowercase().to_string())
        .collect();

    let word_idx = headers.iter().position(|h| h == "word" || h == "单词");
    let note_i = headers.iter().position(|h| h == "note" || h == "备注");

    // If no recognized header, treat the whole file as a plain word list
    if word_idx.is_none() {
        return lines.iter().filter_map(|line| {
            let word = line.trim().trim_matches('"').to_string();
            if word.is_empty() { None } else { Some(ImportWord { word, note: None }) }
        }).collect();
    }

    let wi = word_idx.unwrap();
    lines[1..].iter().filter_map(|line| {
        let cols = split_csv_line(line);
        let word = cols.get(wi).map(|s| s.trim().trim_matches('"').to_string()).filter(|s| !s.is_empty())?;
        Some(ImportWord {
            word,
            note: note_i.and_then(|i| cols.get(i)).map(|s| s.trim().trim_matches('"').to_string()).filter(|s| !s.is_empty()),
        })
    }).collect()
}

#[tauri::command]
pub async fn preview_import_file(path: String, skip_header: bool) -> Result<ImportPreview, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let words = parse_import_content(&path, &content, skip_header);
    let sample = words.iter().take(5).map(|w| w.word.clone()).collect();
    Ok(ImportPreview { total: words.len(), sample })
}

#[tauri::command]
pub async fn import_vocabulary_from_file(path: String, tag_id: Option<i64>, skip_header: bool) -> Result<ImportResult, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let words = parse_import_content(&path, &content, skip_header);

    let db = DB.get().unwrap().lock().unwrap();
    let mut imported = 0usize;
    let mut tag_added = 0usize;
    let mut skipped = 0usize;

    for w in &words {
        let vocab_id: Option<i64> = db.query_row(
            "SELECT id FROM vocabulary WHERE word=?1",
            params![&w.word], |row| row.get(0),
        ).ok();

        if let Some(vid) = vocab_id {
            // Word already exists — try to add tag if provided
            if let Some(tid) = tag_id {
                let has_tag: i64 = db.query_row(
                    "SELECT COUNT(*) FROM vocabulary_tags WHERE vocabulary_id=?1 AND tag_id=?2",
                    params![vid, tid], |row| row.get(0),
                ).unwrap_or(0);
                if has_tag > 0 {
                    skipped += 1;
                } else {
                    db.execute(
                        "INSERT OR IGNORE INTO vocabulary_tags (vocabulary_id, tag_id) VALUES (?1, ?2)",
                        params![vid, tid],
                    ).map_err(|e| e.to_string())?;
                    tag_added += 1;
                }
            } else {
                skipped += 1;
            }
            continue;
        }

        db.execute(
            "INSERT INTO vocabulary (word, note) VALUES (?1, ?2)",
            params![&w.word, w.note.as_deref()],
        ).map_err(|e| e.to_string())?;

        let new_id = db.last_insert_rowid();
        if let Some(tid) = tag_id {
            db.execute(
                "INSERT OR IGNORE INTO vocabulary_tags (vocabulary_id, tag_id) VALUES (?1, ?2)",
                params![new_id, tid],
            ).map_err(|e| e.to_string())?;
        }
        imported += 1;
    }

    Ok(ImportResult { imported, tag_added, skipped })
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VocabularyItem {
    pub id: i64,
    pub word: String,
    pub note: Option<String>,
    pub starred: bool,
    pub created_at: String,
    pub updated_at: String,
    pub tags: Vec<Tag>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub is_default: bool,
}

#[tauri::command]
pub async fn add_to_vocabulary(word: String, tag_id: Option<i64>) -> Result<VocabularyItem, String> {
    let db = DB.get().unwrap().lock().unwrap();

    db.execute(
        "INSERT INTO vocabulary (word) VALUES (?1)
         ON CONFLICT(word) DO UPDATE SET updated_at=CURRENT_TIMESTAMP",
        params![word],
    ).map_err(|e| e.to_string())?;

    let vocab_id: i64 = db.query_row(
        "SELECT id FROM vocabulary WHERE word=?1",
        params![word],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    // Use explicit tag or fall back to default tag
    let effective_tag = if let Some(tid) = tag_id {
        Some(tid)
    } else {
        db.query_row(
            "SELECT id FROM tags WHERE is_default=1 LIMIT 1",
            [], |row| row.get::<_, i64>(0),
        ).ok()
    };

    if let Some(tid) = effective_tag {
        db.execute(
            "INSERT OR IGNORE INTO vocabulary_tags (vocabulary_id, tag_id) VALUES (?1, ?2)",
            params![vocab_id, tid],
        ).map_err(|e| e.to_string())?;
    }

    let item = db.query_row(
        "SELECT id, word, note, starred, created_at, updated_at FROM vocabulary WHERE id=?1",
        params![vocab_id],
        |row| Ok(VocabularyItem {
            id: row.get(0)?,
            word: row.get(1)?,
            note: row.get(2)?,
            starred: row.get::<_, i64>(3)? != 0,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
            tags: vec![],
        }),
    ).map_err(|e| e.to_string())?;

    Ok(item)
}

#[tauri::command]
pub async fn remove_from_vocabulary(word: String) -> Result<(), String> {
    let db = DB.get().unwrap().lock().unwrap();
    db.execute("DELETE FROM vocabulary WHERE word=?1", params![word])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn is_in_vocabulary(word: String) -> Result<bool, String> {
    let db = DB.get().unwrap().lock().unwrap();
    let count: i64 = db.query_row(
        "SELECT COUNT(*) FROM vocabulary WHERE word=?1",
        params![word],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    Ok(count > 0)
}

#[tauri::command]
pub async fn count_vocabulary(tag_id: Option<i64>, has_note: bool) -> Result<i64, String> {
    let db = DB.get().unwrap().lock().unwrap();
    let hn = has_note as i64;
    let count = if let Some(tid) = tag_id {
        db.query_row(
            "SELECT COUNT(*) FROM vocabulary v
             JOIN vocabulary_tags vt ON vt.vocabulary_id=v.id AND vt.tag_id=?1
             WHERE (?2=0 OR (v.note IS NOT NULL AND v.note != ''))",
            params![tid, hn], |row| row.get(0),
        )
    } else {
        db.query_row(
            "SELECT COUNT(*) FROM vocabulary
             WHERE (?1=0 OR (note IS NOT NULL AND note != ''))",
            params![hn], |row| row.get(0),
        )
    }.map_err(|e| e.to_string())?;
    Ok(count)
}

#[tauri::command]
pub async fn list_vocabulary(tag_id: Option<i64>, limit: i64, offset: i64, has_note: bool) -> Result<Vec<VocabularyItem>, String> {
    let db = DB.get().unwrap().lock().unwrap();
    let hn = has_note as i64;

    type Row = (i64, String, Option<String>, bool, String, String,
                Option<i64>, Option<String>, Option<String>, Option<bool>);

    // Paginate on distinct vocabulary ids, then JOIN tags for those ids only
    let rows: Vec<Row> = if let Some(tid) = tag_id {
        let mut stmt = db.prepare(
            "SELECT v.id, v.word, v.note, v.starred, v.created_at, v.updated_at,
                    t.id, t.name, t.color, t.is_default
             FROM (
               SELECT v2.id, v2.word, v2.note, v2.starred, v2.created_at, v2.updated_at
               FROM vocabulary v2
               JOIN vocabulary_tags vt_f ON vt_f.vocabulary_id=v2.id AND vt_f.tag_id=?1
               WHERE (?4=0 OR (v2.note IS NOT NULL AND v2.note != ''))
               ORDER BY v2.word COLLATE NOCASE ASC
               LIMIT ?2 OFFSET ?3
             ) v
             LEFT JOIN vocabulary_tags vt ON vt.vocabulary_id=v.id
             LEFT JOIN tags t ON t.id=vt.tag_id
             ORDER BY v.word COLLATE NOCASE ASC, t.id"
        ).map_err(|e| e.to_string())?;
        let x = stmt.query_map(params![tid, limit, offset, hn], |row| Ok((
            row.get(0)?, row.get(1)?, row.get(2)?,
            row.get::<_, i64>(3)? != 0, row.get(4)?, row.get(5)?,
            row.get(6)?, row.get(7)?, row.get(8)?,
            row.get::<_, Option<i64>>(9)?.map(|v| v != 0),
        ))).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect(); x
    } else {
        let mut stmt = db.prepare(
            "SELECT v.id, v.word, v.note, v.starred, v.created_at, v.updated_at,
                    t.id, t.name, t.color, t.is_default
             FROM (
               SELECT v2.id, v2.word, v2.note, v2.starred, v2.created_at, v2.updated_at
               FROM vocabulary v2
               WHERE (?3=0 OR (v2.note IS NOT NULL AND v2.note != ''))
               ORDER BY v2.word COLLATE NOCASE ASC
               LIMIT ?1 OFFSET ?2
             ) v
             LEFT JOIN vocabulary_tags vt ON vt.vocabulary_id=v.id
             LEFT JOIN tags t ON t.id=vt.tag_id
             ORDER BY v.word COLLATE NOCASE ASC, t.id"
        ).map_err(|e| e.to_string())?;
        let x = stmt.query_map(params![limit, offset, hn], |row| Ok((
            row.get(0)?, row.get(1)?, row.get(2)?,
            row.get::<_, i64>(3)? != 0, row.get(4)?, row.get(5)?,
            row.get(6)?, row.get(7)?, row.get(8)?,
            row.get::<_, Option<i64>>(9)?.map(|v| v != 0),
        ))).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect(); x
    };

    let mut items: Vec<VocabularyItem> = vec![];
    for (id, word, note, starred, created_at, updated_at,
         tag_id_opt, tag_name, tag_color, tag_default) in rows
    {
        if items.last().map(|i: &VocabularyItem| i.id) != Some(id) {
            items.push(VocabularyItem {
                id, word, note, starred,
                created_at, updated_at, tags: vec![],
            });
        }
        if let (Some(tid), Some(name), Some(color), Some(is_default)) =
            (tag_id_opt, tag_name, tag_color, tag_default)
        {
            items.last_mut().unwrap().tags.push(Tag { id: tid, name, color, is_default });
        }
    }

    Ok(items)
}

#[tauri::command]
pub async fn update_vocabulary_note(word: String, note: String) -> Result<(), String> {
    let db = DB.get().unwrap().lock().unwrap();
    db.execute(
        "UPDATE vocabulary SET note=?1, updated_at=CURRENT_TIMESTAMP WHERE word=?2",
        params![note, word],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn toggle_star(word: String) -> Result<(), String> {
    let db = DB.get().unwrap().lock().unwrap();
    db.execute(
        "UPDATE vocabulary SET starred = NOT starred, updated_at=CURRENT_TIMESTAMP WHERE word=?1",
        params![word],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Tag commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_tags() -> Result<Vec<Tag>, String> {
    let db = DB.get().unwrap().lock().unwrap();
    let mut stmt = db.prepare("SELECT id, name, color, is_default FROM tags ORDER BY name")
        .map_err(|e| e.to_string())?;
    let tags: Vec<Tag> = stmt
        .query_map([], |row| Ok(Tag {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
            is_default: row.get::<_, i64>(3)? != 0,
        }))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(tags)
}

#[tauri::command]
pub async fn create_tag(name: String, color: String) -> Result<Tag, String> {
    let db = DB.get().unwrap().lock().unwrap();
    db.execute(
        "INSERT OR IGNORE INTO tags (name, color) VALUES (?1, ?2)",
        params![name, color],
    ).map_err(|e| e.to_string())?;
    let tag = db.query_row(
        "SELECT id, name, color, is_default FROM tags WHERE name=?1",
        params![name],
        |row| Ok(Tag {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
            is_default: row.get::<_, i64>(3)? != 0,
        }),
    ).map_err(|e| e.to_string())?;
    Ok(tag)
}

#[tauri::command]
pub async fn rename_tag(id: i64, name: String) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() { return Err("标签名不能为空".into()); }
    let db = DB.get().unwrap().lock().unwrap();
    db.execute("UPDATE tags SET name=?1 WHERE id=?2", params![name, id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_tag(id: i64) -> Result<(), String> {
    let db = DB.get().unwrap().lock().unwrap();
    db.execute("DELETE FROM tags WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn set_default_tag(tag_id: Option<i64>) -> Result<(), String> {
    let db = DB.get().unwrap().lock().unwrap();
    db.execute("UPDATE tags SET is_default=0", []).map_err(|e| e.to_string())?;
    if let Some(id) = tag_id {
        db.execute("UPDATE tags SET is_default=1 WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_vocabulary_tags(word: String) -> Result<Vec<Tag>, String> {
    let db = DB.get().unwrap().lock().unwrap();
    let vocab_id: i64 = db.query_row(
        "SELECT id FROM vocabulary WHERE word=?1",
        params![word],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    let mut stmt = db.prepare(
        "SELECT t.id, t.name, t.color, t.is_default FROM tags t
         JOIN vocabulary_tags vt ON vt.tag_id=t.id
         WHERE vt.vocabulary_id=?1"
    ).map_err(|e| e.to_string())?;
    let tags: Vec<Tag> = stmt
        .query_map(params![vocab_id], |row| Ok(Tag {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
            is_default: row.get::<_, i64>(3)? != 0,
        }))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(tags)
}

#[tauri::command]
pub async fn add_tag_to_word(word: String, tag_id: i64) -> Result<(), String> {
    let db = DB.get().unwrap().lock().unwrap();
    let vocab_id: i64 = db.query_row(
        "SELECT id FROM vocabulary WHERE word=?1",
        params![word],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    db.execute(
        "INSERT OR IGNORE INTO vocabulary_tags (vocabulary_id, tag_id) VALUES (?1, ?2)",
        params![vocab_id, tag_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn remove_tag_from_word(word: String, tag_id: i64) -> Result<(), String> {
    let db = DB.get().unwrap().lock().unwrap();
    let vocab_id: i64 = db.query_row(
        "SELECT id FROM vocabulary WHERE word=?1",
        params![word],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    db.execute(
        "DELETE FROM vocabulary_tags WHERE vocabulary_id=?1 AND tag_id=?2",
        params![vocab_id, tag_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
