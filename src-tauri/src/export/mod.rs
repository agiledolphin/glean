use crate::db::DB;
use anyhow::Result;
use rusqlite::params;

pub fn export_vocabulary_markdown(tag_id: Option<i64>) -> Result<String> {
    let db = DB.get().unwrap().lock().unwrap();

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut md = format!("# 生词本 - {today}\n\n");

    // Fetch vocabulary words
    let words: Vec<(i64, String)> = if let Some(tid) = tag_id {
        let mut stmt = db.prepare(
            "SELECT v.id, v.word
             FROM vocabulary v
             JOIN vocabulary_tags vt ON vt.vocabulary_id=v.id
             WHERE vt.tag_id=?1
             ORDER BY v.created_at DESC",
        )?;
        stmt.query_map(params![tid], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    } else {
        let mut stmt = db.prepare(
            "SELECT id, word FROM vocabulary ORDER BY created_at DESC",
        )?;
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    };

    for (id, word) in &words {
        // Fetch tags for this word
        let mut tag_stmt = db.prepare(
            "SELECT t.name FROM tags t
             JOIN vocabulary_tags vt ON vt.tag_id=t.id
             WHERE vt.vocabulary_id=?1
             ORDER BY t.name",
        )?;
        let tags: Vec<String> = tag_stmt
            .query_map(params![id], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        if tags.is_empty() {
            md.push_str(&format!("{word}\n"));
        } else {
            let tag_str = tags.iter().map(|t| format!("#{t}")).collect::<Vec<_>>().join(" ");
            md.push_str(&format!("{word}  {tag_str}\n"));
        }
    }

    Ok(md)
}

#[tauri::command]
pub async fn export_vocabulary(tag_id: Option<i64>, path: String) -> Result<(), String> {
    let content = export_vocabulary_markdown(tag_id).map_err(|e| e.to_string())?;
    std::fs::write(&path, &content).map_err(|e| e.to_string())?;
    Ok(())
}
