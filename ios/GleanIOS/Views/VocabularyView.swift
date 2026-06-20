import SwiftUI
import GRDB

struct VocabularyView: View {
    @Environment(\.appDatabase) private var db
    @State private var words: [VocabularyWord] = []

    var body: some View {
        NavigationStack {
            Group {
                if words.isEmpty {
                    ContentUnavailableView(
                        "生词本为空",
                        systemImage: "book",
                        description: Text("查词时收藏单词即可加入生词本")
                    )
                } else {
                    List(words, id: \.id) { word in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(word.word)
                                .font(.body)
                            if let note = word.note, !note.isEmpty {
                                Text(note)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                    }
                }
            }
            .navigationTitle("生词本")
            .task { await loadWords() }
        }
    }

    private func loadWords() async {
        do {
            words = try await db.dbWriter.read { db in
                try VocabularyWord.order(Column("created_at").desc).fetchAll(db)
            }
        } catch {
            print("VocabularyView load error: \(error)")
        }
    }
}
