@preconcurrency import GRDB
import Foundation

struct VocabularyWord: Codable, FetchableRecord, MutablePersistableRecord {
    static let databaseTableName = "vocabulary"
    nonisolated(unsafe) static let databaseColumnDecodingStrategy = DatabaseColumnDecodingStrategy.convertFromSnakeCase
    nonisolated(unsafe) static let databaseColumnEncodingStrategy = DatabaseColumnEncodingStrategy.convertToSnakeCase

    var id: Int64?
    var word: String
    var note: String?
    var starred: Bool
    var createdAt: Date
    var updatedAt: Date

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }

    static let tags = hasMany(Tag.self, through: hasMany(VocabularyTag.self), using: VocabularyTag.tag)
}

struct Tag: Codable, FetchableRecord, MutablePersistableRecord {
    static let databaseTableName = "tags"
    nonisolated(unsafe) static let databaseColumnDecodingStrategy = DatabaseColumnDecodingStrategy.convertFromSnakeCase
    nonisolated(unsafe) static let databaseColumnEncodingStrategy = DatabaseColumnEncodingStrategy.convertToSnakeCase

    var id: Int64?
    var name: String
    var color: String
    var isDefault: Bool

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}

struct VocabularyTag: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "vocabulary_tags"
    nonisolated(unsafe) static let databaseColumnDecodingStrategy = DatabaseColumnDecodingStrategy.convertFromSnakeCase
    nonisolated(unsafe) static let databaseColumnEncodingStrategy = DatabaseColumnEncodingStrategy.convertToSnakeCase

    var vocabularyId: Int64
    var tagId: Int64

    static let tag = belongsTo(Tag.self)
}
