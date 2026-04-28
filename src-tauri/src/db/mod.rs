use anyhow::Result;
use once_cell::sync::OnceCell;
use rusqlite::{Connection, params};
use std::path::PathBuf;
use std::sync::Mutex;

pub static DB: OnceCell<Mutex<Connection>> = OnceCell::new();

pub fn data_dir() -> PathBuf {
    let home = dirs::home_dir().expect("cannot find home dir");
    home.join(".glean")
}

pub fn init() -> Result<()> {
    let dir = data_dir();
    std::fs::create_dir_all(&dir)?;
    std::fs::create_dir_all(dir.join("dicts"))?;

    let db_path = dir.join("glean.db");
    let conn = Connection::open(&db_path)?;

    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;

    create_schema(&conn)?;
    migrate_schema(&conn)?;

    DB.set(Mutex::new(conn))
        .map_err(|_| anyhow::anyhow!("DB already initialized"))?;

    Ok(())
}

fn create_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS query_history (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            word       TEXT NOT NULL,
            dict_id    TEXT,
            queried_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_query_history_word ON query_history(word);

        CREATE TABLE IF NOT EXISTS word_stats (
            word        TEXT PRIMARY KEY,
            query_count INTEGER DEFAULT 1,
            first_seen  DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_seen   DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS vocabulary (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            word       TEXT NOT NULL UNIQUE,
            note       TEXT,
            starred    INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS tags (
            id    INTEGER PRIMARY KEY AUTOINCREMENT,
            name  TEXT NOT NULL UNIQUE,
            color TEXT DEFAULT '#8FAF8F'
        );

        CREATE TABLE IF NOT EXISTS vocabulary_tags (
            vocabulary_id INTEGER REFERENCES vocabulary(id) ON DELETE CASCADE,
            tag_id        INTEGER REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY (vocabulary_id, tag_id)
        );

        CREATE TABLE IF NOT EXISTS dictionaries (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            file_path  TEXT NOT NULL,
            enabled    INTEGER DEFAULT 1,
            sort_order INTEGER DEFAULT 0,
            added_at   DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    ")?;
    Ok(())
}

fn migrate_schema(conn: &Connection) -> Result<()> {
    let has_level: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('vocabulary') WHERE name='level'",
        [], |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    if !has_level {
        conn.execute("ALTER TABLE vocabulary ADD COLUMN level INTEGER NOT NULL DEFAULT 0", [])?;
    }

    let has_is_default: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('tags') WHERE name='is_default'",
        [], |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    if !has_is_default {
        conn.execute("ALTER TABLE tags ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0", [])?;
    }

    Ok(())
}

pub fn record_query(word: &str, dict_id: Option<&str>) -> Result<()> {
    let db = DB.get().unwrap().lock().unwrap();

    db.execute(
        "INSERT INTO query_history (word, dict_id) VALUES (?1, ?2)",
        params![word, dict_id],
    )?;

    db.execute(
        "INSERT INTO word_stats (word, query_count, last_seen)
         VALUES (?1, 1, CURRENT_TIMESTAMP)
         ON CONFLICT(word) DO UPDATE SET
             query_count = query_count + 1,
             last_seen = CURRENT_TIMESTAMP",
        params![word],
    )?;

    Ok(())
}
