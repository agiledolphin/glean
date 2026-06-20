import SwiftUI

struct DictDetailView: View {
    let word: String
    @Environment(\.dictManager) private var dictManager

    @State private var results: [DictManager.DictResult] = []
    @State private var isLoading = true
    @State private var currentPage = 0

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
        .task { await load() }
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
                    DictPageView(result: results[i])
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

    func makeUIViewController(context: Context) -> DictPageVC {
        DictPageVC(result: result)
    }

    func updateUIViewController(_ vc: DictPageVC, context: Context) {
        vc.load(result: result)
    }
}

import WebKit
import UIKit

final class DictPageVC: UIViewController {
    private let webView: WKWebView = {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        let wv = WKWebView(frame: .zero, configuration: config)
        wv.isOpaque = false
        wv.backgroundColor = .systemBackground
        return wv
    }()

    private var currentResult: DictManager.DictResult?

    init(result: DictManager.DictResult) {
        self.currentResult = result
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
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
}
