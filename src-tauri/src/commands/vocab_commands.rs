use crate::db::DB;
use anyhow::Result;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VocabularyItem {
    pub id: i64,
    pub word: String,
    pub note: Option<String>,
    pub starred: bool,
    pub level: u8,
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
pub async fn add_to_vocabulary(word: String, tag_id: Option<i64>, level: u8) -> Result<VocabularyItem, String> {
    let db = DB.get().unwrap().lock().unwrap();

    db.execute(
        "INSERT INTO vocabulary (word, level) VALUES (?1, ?2)
         ON CONFLICT(word) DO UPDATE SET level=excluded.level, updated_at=CURRENT_TIMESTAMP",
        params![word, level as i64],
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
        "SELECT id, word, note, starred, level, created_at, updated_at FROM vocabulary WHERE id=?1",
        params![vocab_id],
        |row| Ok(VocabularyItem {
            id: row.get(0)?,
            word: row.get(1)?,
            note: row.get(2)?,
            starred: row.get::<_, i64>(3)? != 0,
            level: row.get::<_, i64>(4)? as u8,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
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
pub async fn list_vocabulary(tag_id: Option<i64>) -> Result<Vec<VocabularyItem>, String> {
    let db = DB.get().unwrap().lock().unwrap();

    type Row = (i64, String, Option<String>, bool, i64, String, String);
    let words: Vec<Row> = if let Some(tid) = tag_id {
        let mut stmt = db.prepare(
            "SELECT v.id, v.word, v.note, v.starred, v.level, v.created_at, v.updated_at
             FROM vocabulary v
             JOIN vocabulary_tags vt ON vt.vocabulary_id=v.id
             WHERE vt.tag_id=?1
             ORDER BY v.created_at DESC"
        ).map_err(|e| e.to_string())?;
        let x: Vec<Row> = stmt.query_map(params![tid], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get::<_, i64>(3)? != 0, row.get(4)?, row.get(5)?, row.get(6)?))
        }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        x
    } else {
        let mut stmt = db.prepare(
            "SELECT id, word, note, starred, level, created_at, updated_at
             FROM vocabulary ORDER BY created_at DESC"
        ).map_err(|e| e.to_string())?;
        let x: Vec<Row> = stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get::<_, i64>(3)? != 0, row.get(4)?, row.get(5)?, row.get(6)?))
        }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        x
    };

    let mut items: Vec<VocabularyItem> = words
        .into_iter()
        .map(|(id, word, note, starred, level, created_at, updated_at)| VocabularyItem {
            id, word, note, starred, level: level as u8, created_at, updated_at, tags: vec![],
        })
        .collect();

    for item in &mut items {
        let mut stmt = db.prepare(
            "SELECT t.id, t.name, t.color, t.is_default FROM tags t
             JOIN vocabulary_tags vt ON vt.tag_id=t.id
             WHERE vt.vocabulary_id=?1"
        ).map_err(|e| e.to_string())?;
        item.tags = stmt
            .query_map(params![item.id], |row| Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                is_default: row.get::<_, i64>(3)? != 0,
            }))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
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
pub async fn update_vocabulary_level(word: String, level: u8) -> Result<(), String> {
    let db = DB.get().unwrap().lock().unwrap();
    db.execute(
        "UPDATE vocabulary SET level=?1, updated_at=CURRENT_TIMESTAMP WHERE word=?2",
        params![level as i64, word],
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
