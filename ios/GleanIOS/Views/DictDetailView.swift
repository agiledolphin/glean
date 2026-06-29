import SwiftUI
import GRDB

struct DictDetailView: View {
    let word: String
    @Environment(\.dictManager) private var dictManager
    @Environment(\.appDatabase) private var db

    @State private var results: [DictManager.DictResult] = []
    @State private var isLoading = true
    @State private var currentPage = 0
    @State private var isInVocab = false
    @State private var vocabLoading = false

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
            } else if results.isEmpty {
                ContentUnavailableView(
                    "未找到「\(word)」",
                    systemImage: "magnifyingglass",
                    description: Text("词典中没有该词条")
                )
            } else {
                pageView
            }
        }
        .navigationTitle(word)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    Task { await toggleVocab() }
                } label: {
                    Image(systemName: isInVocab ? "bookmark.fill" : "bookmark")
                }
                .disabled(vocabLoading)
            }
        }
        .task {
            await load()
            await checkVocab()
        }
    }

    private func checkVocab() async {
        do {
            isInVocab = try await db.dbWriter.read { db in
                try VocabularyWord.filter(Column("word") == word).fetchCount(db) > 0
            }
        } catch {}
    }

    private func toggleVocab() async {
        vocabLoading = true
        defer { vocabLoading = false }
        do {
            if isInVocab {
                _ = try await db.dbWriter.write { [word] db in
                    try VocabularyWord.filter(Column("word") == word).deleteAll(db)
                }
                isInVocab = false
            } else {
                try await db.dbWriter.write { [word] db in
                    var v = VocabularyWord(word: word, note: nil, starred: false,
                                          createdAt: Date(), updatedAt: Date())
                    try v.insert(db)
                }
                isInVocab = true
            }
        } catch {
            print("toggleVocab error: \(error)")
        }
    }

    // MARK: - Page view

    private var pageView: some View {
        VStack(spacing: 0) {
            // Dict selector tabs (only when multiple dicts)
            if results.count > 1 {
                dictTabs
                Divider()
            }

            // Swipeable pages — each WKWebView scrolls independently
            TabView(selection: $currentPage) {
                ForEach(results.indices, id: \.self) { i in
                    DictPageView(result: results[i], dictManager: dictManager)
                        .tag(i)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
        }
    }

    private var dictTabs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 0) {
                ForEach(results.indices, id: \.self) { i in
                    Button {
                        withAnimation { currentPage = i }
                    } label: {
                        Text(shortTitle(results[i].title))
                            .font(.caption)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .foregroundStyle(currentPage == i ? .primary : .secondary)
                    }
                    .overlay(alignment: .bottom) {
                        if currentPage == i {
                            Rectangle()
                                .frame(height: 2)
                                .foregroundStyle(Color.accentColor)
                        }
                    }
                }
            }
        }
        .frame(height: 36)
        .background(Color(.systemBackground))
    }

    private func shortTitle(_ title: String) -> String {
        // Keep first ~8 chars to avoid overly long tab labels
        if title.count <= 10 { return title }
        let words = title.components(separatedBy: "（")
        return words.first.map { $0.trimmingCharacters(in: .whitespaces) } ?? title
    }

    private func load() async {
        isLoading = true
        results = dictManager.lookup(word)
        isLoading = false
    }
}

// MARK: - Single dictionary page

struct DictPageView: UIViewControllerRepresentable {
    let result: DictManager.DictResult
    let dictManager: DictManager

    func makeUIViewController(context: Context) -> DictPageVC {
        DictPageVC(result: result, dictManager: dictManager)
    }

    func updateUIViewController(_ vc: DictPageVC, context: Context) {
        vc.load(result: result)
    }
}

import WebKit
import UIKit
import AVFoundation

final class DictPageVC: UIViewController, WKNavigationDelegate {
    private let webView: WKWebView = {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        let wv = WKWebView(frame: .zero, configuration: config)
        wv.isOpaque = false
        wv.backgroundColor = .systemBackground
        return wv
    }()

    private let dictManager: DictManager
    private var currentResult: DictManager.DictResult?
    private var audioPlayer: AVAudioPlayer?

    init(result: DictManager.DictResult, dictManager: DictManager) {
        self.dictManager = dictManager
        self.currentResult = result
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        webView.navigationDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        if let r = currentResult { load(result: r) }
    }

    func load(result: DictManager.DictResult) {
        guard isViewLoaded else { currentResult = result; return }
        let baseCSS = """
            body { font-family: -apple-system, sans-serif; font-size: 16px;
                   line-height: 1.6; padding: 12px 16px 32px;
                   margin: 0; color: #1c1c1e; word-break: break-word; }
            a { color: #007aff; text-decoration: none; }
            img { max-width: 100%; height: auto; }
            li:empty { display: none; }
        """
        let dictStyle = result.css.map { "<style>\($0)</style>" } ?? ""
        let html = """
        <!DOCTYPE html><html><head>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>\(baseCSS)</style>
        \(dictStyle)
        </head><body>\(result.html)</body></html>
        """
        let baseURL = result.dictDirPath.map { URL(fileURLWithPath: $0) }
        webView.loadHTMLString(html, baseURL: baseURL)
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else { return .allow }
        if url.scheme == "sound" {
            // sound://path/to/file.mp3 → path/to/file.mp3
            let path = (url.host ?? "") + url.path
            let soundPath = path.hasPrefix("/") ? String(path.dropFirst()) : path
            playSound(soundPath)
            return .cancel
        }
        // Allow initial HTML load; block other link navigation
        return navigationAction.navigationType == .other ? .allow : .cancel
    }

    private func playSound(_ soundPath: String) {
        guard let data = dictManager.audioData(for: soundPath), !data.isEmpty else { return }
        do {
            audioPlayer = try AVAudioPlayer(data: data)
            audioPlayer?.play()
        } catch {
            print("DictPageVC: audio play error: \(error)")
        }
    }
}
