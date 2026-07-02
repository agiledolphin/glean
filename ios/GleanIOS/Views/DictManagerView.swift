import SwiftUI
import UniformTypeIdentifiers

struct DictManagerView: View {
    @Environment(\.dictManager) private var dictManager
    @Environment(\.dismiss) private var dismiss

    @State private var showImporter = false
    @State private var importing = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Group {
                if dictManager.dicts.isEmpty {
                    ContentUnavailableView(
                        "还没有词典",
                        systemImage: "books.vertical",
                        description: Text("点击右上角导入包含 .mdx 文件的词典文件夹")
                    )
                } else {
                    List {
                        if !DictManager.deletionAllowed {
                            Section {
                                Text("Simulator 与 Mac 共享同一份词典目录，为避免误删 Mac 端文件，这里暂不支持删除；真机上可以左滑删除。")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        if DictManager.deletionAllowed {
                            Section {
                                ForEach(dictManager.dicts, id: \.filePath) { dict in
                                    Text(dict.meta.title)
                                        .font(.body)
                                }
                                .onDelete(perform: deleteDicts)
                            }
                        } else {
                            Section {
                                ForEach(dictManager.dicts, id: \.filePath) { dict in
                                    Text(dict.meta.title)
                                        .font(.body)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("词典管理")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("完成") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    if importing {
                        ProgressView()
                    } else {
                        Button {
                            showImporter = true
                        } label: {
                            Image(systemName: "plus")
                        }
                    }
                }
            }
            .fileImporter(isPresented: $showImporter, allowedContentTypes: [.folder]) { result in
                switch result {
                case .success(let url):
                    Task { await runImport(from: url) }
                case .failure(let error):
                    errorMessage = error.localizedDescription
                }
            }
            .alert("导入失败", isPresented: .constant(errorMessage != nil), presenting: errorMessage) { _ in
                Button("好") { errorMessage = nil }
            } message: { message in
                Text(message)
            }
        }
    }

    private func runImport(from url: URL) async {
        importing = true
        defer { importing = false }
        do {
            try await dictManager.importDictionary(from: url)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteDicts(at offsets: IndexSet) {
        let targets = offsets.map { dictManager.dicts[$0] }
        Task {
            for dict in targets {
                await dictManager.deleteDictionary(dict)
            }
        }
    }
}
