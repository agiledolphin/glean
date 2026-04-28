use crate::db::DB;
use anyhow::Result;
use rusqlite::params;

pub fn export_vocabulary_markdown(tag_id: Option<i64>) -> Result<String> {
    let db = DB.get().unwrap().lock().unwrap();

    let tag_label: String = if let Some(tid) = tag_id {
        db.query_row(
            "SELECT name FROM tags WHERE id=?1",
            params![tid],
            |row| row.get(0),
        ).unwrap_or_else(|_| "未分类".to_string())
    } else {
        "全部".to_string()
    };

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut md = format!("# 生词本 - {tag_label} - {today}\n\n");

    // Fetch vocabulary
    let words: Vec<(String, Option<String>, String)> = if let Some(tid) = tag_id {
        let mut stmt = db.prepare(
            "SELECT v.word, v.note, v.created_at
             FROM vocabulary v
             JOIN vocabulary_tags vt ON vt.vocabulary_id=v.id
             WHERE vt.tag_id=?1
             ORDER BY v.created_at DESC"
        )?;
        stmt.query_map(params![tid], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    } else {
        let mut stmt = db.prepare(
            "SELECT word, note, created_at FROM vocabulary ORDER BY created_at DESC"
        )?;
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    };

    for (word, note, created_at) in &words {
        let count: i64 = db.query_row(
            "SELECT COALESCE(query_count, 0) FROM word_stats WHERE word=?1",
            params![word],
            |row| row.get(0),
        ).unwrap_or(0);

        md.push_str(&format!("## {word}\n"));
        if let Some(n) = note.as_deref().filter(|n| !n.is_empty()) {
            md.push_str(&format!("- **备注：** {n}\n"));
        }
        md.push_str(&format!("- **查询次数：** {count}\n"));
        let date = created_at.split('T').next().unwrap_or(created_at.as_str());
        md.push_str(&format!("- **加入时间：** {date}\n"));
        md.push_str("\n---\n\n");
    }

    Ok(md)
}

#[tauri::command]
pub async fn export_vocabulary(tag_id: Option<i64>) -> Result<String, String> {
    let content = export_vocabulary_markdown(tag_id).map_err(|e| e.to_string())?;

    // Write to a temp file and return path for the frontend to handle
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let filename = format!("glean-vocabulary-{today}.md");
    let out_path = crate::db::data_dir().join(&filename);
    std::fs::write(&out_path, &content).map_err(|e| e.to_string())?;

    Ok(out_path.to_string_lossy().to_string())
}
