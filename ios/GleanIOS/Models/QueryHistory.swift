import GRDB
import Foundation

struct QueryHistory: Codable, FetchableRecord, MutablePersistableRecord {
    static let databaseTableName = "query_history"

    var id: Int64?
    var word: String
    var dictId: String?
    var queriedAt: Date

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}

struct WordStats: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "word_stats"

    var word: String
    var queryCount: Int
    var firstSeen: Date
    var lastSeen: Date
}
