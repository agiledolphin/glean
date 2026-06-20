import SwiftUI

struct SearchView: View {
    @Environment(\.dictManager) private var dictManager
    @State private var query = ""
    @State private var candidates: [String] = []
    @State private var debounceTask: Task<Void, Never>?
    @State private var selectedWord: String? = nil

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
            .onChange(of: query) { _, newValue in scheduleSearch(newValue) }
            .navigationDestination(item: $selectedWord) { word in
                DictDetailView(word: word)
            }
        }
    }

    private var candidateList: some View {
        List(candidates, id: \.self) { word in
            Button {
                selectedWord = word
            } label: {
                Text(word)
                    .foregroundStyle(.primary)
            }
        }
        .listStyle(.plain)
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
