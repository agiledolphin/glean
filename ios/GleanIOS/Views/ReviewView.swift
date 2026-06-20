import SwiftUI
import GRDB

struct ReviewView: View {
    @Environment(\.appDatabase) private var db
    @State private var stats: ReviewStats = .empty

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                statsGrid
                Spacer()
                startButton
            }
            .padding()
            .navigationTitle("背单词")
            .task { await loadStats() }
        }
    }

    private var statsGrid: some View {
        Grid(horizontalSpacing: 16, verticalSpacing: 16) {
            GridRow {
                statCard(title: "生词本", value: stats.totalInVocab, color: .primary)
                statCard(title: "已复习", value: stats.totalReviewed, color: .blue)
            }
            GridRow {
                statCard(title: "今日到期", value: stats.dueToday, color: .orange)
                statCard(title: "待学新词", value: stats.newWords, color: .green)
            }
        }
        .padding(.top)
    }

    private func statCard(title: String, value: Int, color: Color) -> some View {
        VStack(spacing: 4) {
            Text("\(value)")
                .font(.title.bold())
                .foregroundStyle(color)
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }

    private var startButton: some View {
        let total = stats.dueToday + stats.newWords
        return NavigationLink {
            ReviewSessionView()
                .environment(\.appDatabase, db)
        } label: {
            Text(total > 0 ? "开始复习（\(min(total, 20)) 词）" : "暂无待复习单词")
                .frame(maxWidth: .infinity)
                .padding()
                .background(total > 0 ? Color.accentColor : Color.secondary.opacity(0.3))
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .disabled(total == 0)
    }

    private func loadStats() async {
        do {
            stats = try await db.dbWriter.read { db in
                let totalInVocab = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM vocabulary") ?? 0
                let totalReviewed = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM review_cards WHERE last_reviewed IS NOT NULL") ?? 0
                let dueToday = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM review_cards WHERE due_date <= date('now')") ?? 0
                let newWords = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM vocabulary v LEFT JOIN review_cards rc ON rc.word=v.word WHERE rc.word IS NULL") ?? 0
                return ReviewStats(totalInVocab: totalInVocab, totalReviewed: totalReviewed, dueToday: dueToday, newWords: newWords)
            }
        } catch {
            print("ReviewView stats error: \(error)")
        }
    }
}

struct ReviewStats {
    var totalInVocab: Int
    var totalReviewed: Int
    var dueToday: Int
    var newWords: Int

    static let empty = ReviewStats(totalInVocab: 0, totalReviewed: 0, dueToday: 0, newWords: 0)
}

// MARK: - Session placeholder
struct ReviewSessionView: View {
    var body: some View {
        ContentUnavailableView(
            "复习会话",
            systemImage: "rectangle.on.rectangle",
            description: Text("卡片翻转功能开发中")
        )
        .navigationTitle("背单词")
        .navigationBarTitleDisplayMode(.inline)
    }
}
