import SwiftUI
import GRDB

struct SearchView: View {
    @Environment(\.dictManager) private var dictManager
    @Environment(\.appDatabase) private var db
    @State private var query = ""
    @State private var candidates: [String] = []
    @State private var debounceTask: Task<Void, Never>?
    @State private var selectedWord: String? = nil
    @State private var showDictManager = false

    var body: some View {
        NavigationStack {
            Group {
                if !dictManager.isReady {
                    VStack(spacing: 12) {
                        ProgressView()
                        Text("词库加载中...")
                            .foregroundStyle(.secondary)
                    }
                } else if query.isEmpty {
                    ContentUnavailableView(
                        "拾词",
                        systemImage: "magnifyingglass",
                        description: Text("输入单词开始查询")
                    )
                } else if candidates.isEmpty {
                    ContentUnavailableView.search(text: query)
                } else {
                    candidateList
                }
            }
            .navigationTitle("拾词")
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "输入单词...")
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .onChange(of: query) { _, newValue in scheduleSearch(newValue) }
            .navigationDestination(item: $selectedWord) { word in
                DictDetailView(word: word)
            }
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showDictManager = true
                    } label: {
                        Image(systemName: "books.vertical")
                    }
                }
            }
            .sheet(isPresented: $showDictManager) {
                DictManagerView()
            }
        }
    }

    private var candidateList: some View {
        List(candidates, id: \.self) { word in
            Button {
                selectedWord = word
                Task { await recordQuery(word) }
            } label: {
                Text(word)
                    .foregroundStyle(.primary)
            }
        }
        .listStyle(.plain)
    }

    private func recordQuery(_ word: String) async {
        do {
            try await db.dbWriter.write { db in
                var history = QueryHistory(id: nil, word: word, dictId: nil, queriedAt: Date())
                try history.insert(db)

                if var stats = try WordStats.fetchOne(db, key: word) {
                    stats.queryCount += 1
                    stats.lastSeen = Date()
                    try stats.update(db)
                } else {
                    let stats = WordStats(word: word, queryCount: 1,
                                         firstSeen: Date(), lastSeen: Date())
                    try stats.insert(db)
                }
            }
        } catch {
            print("recordQuery error: \(error)")
        }
    }

    private func scheduleSearch(_ prefix: String) {
        debounceTask?.cancel()
        guard !prefix.isEmpty else { candidates = []; return }
        debounceTask = Task {
            try? await Task.sleep(for: .milliseconds(120))
            guard !Task.isCancelled else { return }
            let results = dictManager.search(prefix)
            candidates = results
        }
    }
}
