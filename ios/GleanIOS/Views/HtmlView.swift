import SwiftUI
import WebKit

struct HtmlView: UIViewRepresentable {
    let html: String
    let css: String?
    let baseURL: URL?
    @Binding var height: CGFloat

    private static let mobileCSS = """
        body { font-family: -apple-system, sans-serif; font-size: 16px;
               line-height: 1.6; padding: 12px 16px; margin: 0;
               color: #1c1c1e; word-break: break-word; }
        a { color: #007aff; text-decoration: none; }
        img { max-width: 100%; height: auto; }
    """

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        let wv = WKWebView(frame: .zero, configuration: config)
        wv.navigationDelegate = context.coordinator
        wv.scrollView.isScrollEnabled = false   // outer ScrollView handles scrolling
        wv.isOpaque = false
        wv.backgroundColor = .clear
        return wv
    }

    func updateUIView(_ wv: WKWebView, context: Context) {
        let dictStyle = css.map { "<style>\($0)</style>" } ?? ""
        let wrapped = """
        <!DOCTYPE html><html><head>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>\(Self.mobileCSS)</style>
        \(dictStyle)
        </head><body>\(html)</body></html>
        """
        wv.loadHTMLString(wrapped, baseURL: baseURL)
    }

    // MARK: - Coordinator

    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: HtmlView

        init(_ parent: HtmlView) { self.parent = parent }

        func webView(_ wv: WKWebView, didFinish navigation: WKNavigation!) {
            // Read the true document height and propagate it up
            wv.evaluateJavaScript("document.body.scrollHeight") { result, _ in
                if let h = result as? CGFloat {
                    DispatchQueue.main.async {
                        self.parent.height = h
                    }
                }
            }
        }
    }
}
