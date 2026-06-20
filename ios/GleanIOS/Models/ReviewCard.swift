import GRDB
import Foundation

struct ReviewCard: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "review_cards"

    var word: String
    var interval: Int
    var easeFactor: Double
    var repetitions: Int
    var dueDate: String
    var lastReviewed: String?
}

extension ReviewCard {
    static func sm2Update(interval: Int, ease: Double, reps: Int, score: Int) -> (interval: Int, ease: Double, reps: Int) {
        let quality: Int
        switch score {
        case 0: quality = 0
        case 1: quality = 2
        case 2: quality = 4
        case 3: quality = 5
        default: quality = 0
        }

        if quality < 3 {
            return (1, ease, 0)
        } else {
            let newEase = max(1.3, ease + 0.1 - Double(5 - quality) * (0.08 + Double(5 - quality) * 0.02))
            let newInterval: Int
            if reps == 0 { newInterval = 1 }
            else if reps == 1 { newInterval = 6 }
            else { newInterval = Int((Double(interval) * newEase).rounded()) }
            return (newInterval, newEase, reps + 1)
        }
    }
}
