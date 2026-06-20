use crate::db::DB;
use rusqlite::params;
use serde::Serialize;

#[derive(Serialize)]
pub struct ReviewCard {
    pub word: String,
    pub due_today: bool, // true = overdue/due, false = new word
}

/// SM-2 update. score: 0=完全不记得 1=模糊 2=认识 3=很熟
fn sm2_update(interval: i64, ease: f64, reps: i64, score: i64) -> (i64, f64, i64) {
    let quality: i64 = match score {
        0 => 0,
        1 => 2,
        2 => 4,
        3 => 5,
        _ => 0,
    };

    if quality < 3 {
        (1, ease, 0)
    } else {
        let new_ease = (ease + 0.1 - (5 - quality) as f64 * (0.08 + (5 - quality) as f64 * 0.02))
            .max(1.3);
        let new_interval = if reps == 0 {
            1
        } else if reps == 1 {
            6
        } else {
            (interval as f64 * new_ease).round() as i64
        };
        (new_interval, new_ease, reps + 1)
    }
}

#[tauri::command]
pub async fn get_review_session() -> Result<Vec<ReviewCard>, String> {
    let db = DB.get().unwrap().lock().unwrap();

    // Due cards (overdue or due today) — random sample for broad coverage
    let mut due: Vec<String> = {
        let mut stmt = db
            .prepare(
                "SELECT word FROM review_cards
                 WHERE due_date <= date('now')
                 ORDER BY RANDOM()
                 LIMIT 20",
            )
            .map_err(|e| e.to_string())?;
        let words: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        words
    };

    // Fill remaining slots with new vocabulary words (not yet in review_cards)
    let remaining = 20usize.saturating_sub(due.len());
    let new_words: Vec<String> = if remaining > 0 {
        let mut stmt = db
            .prepare(
                "SELECT v.word FROM vocabulary v
                 LEFT JOIN review_cards rc ON rc.word = v.word
                 WHERE rc.word IS NULL
                 ORDER BY RANDOM()
                 LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let words: Vec<String> = stmt
            .query_map(params![remaining as i64], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        words
    } else {
        vec![]
    };

    // Insert new words into review_cards so they have a record
    for word in &new_words {
        db.execute(
            "INSERT OR IGNORE INTO review_cards (word) VALUES (?1)",
            params![word],
        )
        .map_err(|e| e.to_string())?;
    }

    let cards: Vec<ReviewCard> = due
        .drain(..)
        .map(|w| ReviewCard { word: w, due_today: true })
        .chain(new_words.into_iter().map(|w| ReviewCard { word: w, due_today: false }))
        .collect();

    Ok(cards)
}

#[tauri::command]
pub async fn submit_review(word: String, score: i64) -> Result<(), String> {
    let db = DB.get().unwrap().lock().unwrap();

    let (interval, ease, reps): (i64, f64, i64) = db
        .query_row(
            "SELECT interval, ease_factor, repetitions FROM review_cards WHERE word=?1",
            params![word],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap_or((1, 2.5, 0));

    let (new_interval, new_ease, new_reps) = sm2_update(interval, ease, reps, score);

    db.execute(
        "INSERT INTO review_cards (word, interval, ease_factor, repetitions, due_date, last_reviewed)
         VALUES (?1, ?2, ?3, ?4, date('now', '+' || ?2 || ' days'), datetime('now'))
         ON CONFLICT(word) DO UPDATE SET
           interval      = excluded.interval,
           ease_factor   = excluded.ease_factor,
           repetitions   = excluded.repetitions,
           due_date      = excluded.due_date,
           last_reviewed = excluded.last_reviewed",
        params![word, new_interval, new_ease, new_reps],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_review_stats() -> Result<serde_json::Value, String> {
    let db = DB.get().unwrap().lock().unwrap();

    let total_in_vocab: i64 = db
        .query_row("SELECT COUNT(*) FROM vocabulary", [], |r| r.get(0))
        .unwrap_or(0);

    let total_reviewed: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM review_cards WHERE last_reviewed IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let due_today: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM review_cards WHERE due_date <= date('now')",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    // New words not yet in review_cards
    let new_words: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM vocabulary v LEFT JOIN review_cards rc ON rc.word=v.word WHERE rc.word IS NULL",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    Ok(serde_json::json!({
        "total_in_vocab": total_in_vocab,
        "total_reviewed": total_reviewed,
        "due_today": due_today,
        "new_words": new_words,
    }))
}
