import SwiftUI
import GRDB

struct VocabularyView: View {
    @Environment(\.appDatabase) private var db
    @State private var words: [VocabularyWord] = []
    @State private var allTags: [Tag] = []
    @State private var selectedTagId: Int64? = nil

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if !allTags.isEmpty {
                    tagFilter
                    Divider()
                }
                if words.isEmpty {
                    ContentUnavailableView(
                        selectedTagId == nil ? "生词本为空" : "该标签下还没有单词",
                        systemImage: "book",
                        description: Text(selectedTagId == nil ? "查词时点击书签即可加入生词本" : "换个标签，或点「全部」查看所有生词")
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    wordList
                }
            }
            .navigationTitle("生词本")
            .task { await loadAll() }
        }
    }

    // MARK: - Tag filter strip

    private var tagFilter: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                tagChip(id: nil, name: "全部", color: nil)
                ForEach(allTags, id: \.id) { tag in
                    tagChip(id: tag.id, name: tag.name, color: tag.color)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
    }

    private func tagChip(id: Int64?, name: String, color: String?) -> some View {
        let selected = selectedTagId == id
        return Button {
            selectedTagId = id
            Task { await loadWords() }
        } label: {
            Text(name)
                .font(.caption)
                .fontWeight(selected ? .semibold : .regular)
                .padding(.horizontal, 12)
                .padding(.vertical, 5)
                .background(chipBackground(color: color, selected: selected))
                .foregroundStyle(chipForeground(color: color, selected: selected))
                .clipShape(Capsule())
                .overlay(Capsule().stroke(chipBorder(color: color, selected: selected), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func chipBackground(color: String?, selected: Bool) -> Color {
        guard selected, let hex = color else {
            return selected ? Color.accentColor.opacity(0.15) : Color(.systemFill)
        }
        return Color(hex: hex).opacity(0.2)
    }

    private func chipForeground(color: String?, selected: Bool) -> Color {
        guard selected, let hex = color else {
            return selected ? .accentColor : .secondary
        }
        return Color(hex: hex)
    }

    private func chipBorder(color: String?, selected: Bool) -> Color {
        guard selected, let hex = color else {
            return selected ? Color.accentColor.opacity(0.4) : Color.clear
        }
        return Color(hex: hex).opacity(0.5)
    }

    // MARK: - Word list

    private var wordList: some View {
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
        .listStyle(.plain)
    }

    // MARK: - Data loading

    private func loadAll() async {
        allTags = (try? await db.dbWriter.read { db in try Tag.fetchAll(db) }) ?? []
        await loadWords()
    }

    private func loadWords() async {
        do {
            words = try await db.dbWriter.read { [selectedTagId] db in
                if let tagId = selectedTagId {
                    // words that have this tag
                    let wordIds = try VocabularyTag
                        .filter(Column("tag_id") == tagId)
                        .fetchAll(db)
                        .map(\.vocabularyId)
                    return try VocabularyWord
                        .filter(wordIds.contains(Column("id")))
                        .order(Column("created_at").desc)
                        .fetchAll(db)
                } else {
                    return try VocabularyWord
                        .order(Column("created_at").desc)
                        .fetchAll(db)
                }
            }
        } catch {
            print("VocabularyView load error: \(error)")
        }
    }
}

// MARK: - Hex color helper

extension Color {
    init(hex: String) {
        let h = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        let val = UInt64(h, radix: 16) ?? 0
        let r = Double((val >> 16) & 0xFF) / 255
        let g = Double((val >> 8) & 0xFF) / 255
        let b = Double(val & 0xFF) / 255
        self.init(red: r, green: g, blue: b)
    }
}
