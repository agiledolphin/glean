use crate::db::DB;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct WordStats {
    pub word: String,
    pub query_count: i64,
    pub first_seen: String,
    pub last_seen: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TrendPoint {
    pub date: String,
    pub count: i64,
}

#[tauri::command]
pub async fn get_word_stats(limit: i64) -> Result<Vec<WordStats>, String> {
    let db = DB.get().unwrap().lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT word, query_count, first_seen, last_seen
         FROM word_stats ORDER BY query_count DESC LIMIT ?1"
    ).map_err(|e| e.to_string())?;
    let stats: Vec<WordStats> = stmt
        .query_map(params![limit], |row| Ok(WordStats {
            word: row.get(0)?,
            query_count: row.get(1)?,
            first_seen: row.get(2)?,
            last_seen: row.get(3)?,
        }))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(stats)
}

#[tauri::command]
pub async fn get_query_trend(days: i64) -> Result<Vec<TrendPoint>, String> {
    let db = DB.get().unwrap().lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT DATE(queried_at) as date, COUNT(*) as count
         FROM query_history
         WHERE queried_at >= DATE('now', '-' || ?1 || ' days')
         GROUP BY DATE(queried_at)
         ORDER BY date ASC"
    ).map_err(|e| e.to_string())?;
    let points: Vec<TrendPoint> = stmt
        .query_map(params![days], |row| Ok(TrendPoint {
            date: row.get(0)?,
            count: row.get(1)?,
        }))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(points)
}
