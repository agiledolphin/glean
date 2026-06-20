import GRDB
import Foundation

final class AppDatabase: Sendable {
    let dbWriter: any DatabaseWriter

    static let shared: AppDatabase = {
        let fm = FileManager.default
        let dir = fm.urls(for: .documentDirectory, in: .userDomainMask).first!.appendingPathComponent("glean")
        try! fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let dbURL = dir.appendingPathComponent("glean.db")
        let pool = try! DatabasePool(path: dbURL.path)
        return try! AppDatabase(pool)
    }()

    init(_ dbWriter: any DatabaseWriter) throws {
        self.dbWriter = dbWriter
        try migrator.migrate(dbWriter)
    }

    private var migrator: DatabaseMigrator {
        var m = DatabaseMigrator()

        m.registerMigration("v1_schema") { db in
            try db.execute(sql: """
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
                CREATE INDEX IF NOT EXISTS idx_vocabulary_word_nocase ON vocabulary(word COLLATE NOCASE);

                CREATE TABLE IF NOT EXISTS tags (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    name       TEXT NOT NULL UNIQUE,
                    color      TEXT DEFAULT '#8FAF8F',
                    is_default INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS vocabulary_tags (
                    vocabulary_id INTEGER REFERENCES vocabulary(id) ON DELETE CASCADE,
                    tag_id        INTEGER REFERENCES tags(id) ON DELETE CASCADE,
                    PRIMARY KEY (vocabulary_id, tag_id)
                );
                CREATE INDEX IF NOT EXISTS idx_vocab_tags_vid ON vocabulary_tags(vocabulary_id);
                CREATE INDEX IF NOT EXISTS idx_vocab_tags_tid ON vocabulary_tags(tag_id);
            """)
        }

        m.registerMigration("v1_review_cards") { db in
            try db.execute(sql: """
                CREATE TABLE IF NOT EXISTS review_cards (
                    word          TEXT PRIMARY KEY REFERENCES vocabulary(word) ON DELETE CASCADE,
                    interval      INTEGER NOT NULL DEFAULT 1,
                    ease_factor   REAL NOT NULL DEFAULT 2.5,
                    repetitions   INTEGER NOT NULL DEFAULT 0,
                    due_date      TEXT NOT NULL DEFAULT (date('now')),
                    last_reviewed TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_review_due ON review_cards(due_date);
            """)
        }

        return m
    }
}

// MARK: - Environment key
import SwiftUI

private struct AppDatabaseKey: EnvironmentKey {
    static let defaultValue = AppDatabase.shared
}

extension EnvironmentValues {
    var appDatabase: AppDatabase {
        get { self[AppDatabaseKey.self] }
        set { self[AppDatabaseKey.self] = newValue }
    }
}
