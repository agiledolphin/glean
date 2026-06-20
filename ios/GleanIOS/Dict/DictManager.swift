import MdxKit
import Observation
import Foundation

@Observable
final class DictManager: @unchecked Sendable {
    var dicts: [MdxDict] = []
    var isReady = false

    // MARK: - Load

    func preload() async {
        let dir = Self.dictsDirectory
        let all = try? FileManager.default.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: [.isDirectoryKey])
        let subdirs = (all ?? []).filter { url in
            (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
        }
        guard !subdirs.isEmpty else {
            isReady = true
            return
        }

        var loaded: [MdxDict] = []
        for subdir in subdirs {
            guard let mdxURL = findMdx(in: subdir) else { continue }
            do {
                let dict = try MdxDict(path: mdxURL.path)
                loaded.append(dict)
                print("MdxKit: loaded \(dict.meta.title)")
            } catch {
                print("MdxKit: failed to load \(mdxURL.lastPathComponent): \(error)")
            }
        }

        dicts = loaded
        isReady = true
    }

    // MARK: - Search

    func search(_ prefix: String, limit: Int = 40) -> [String] {
        guard !prefix.isEmpty else { return [] }
        let lp = prefix.lowercased()
        var seen = Set<String>()
        var results: [String] = []
        for dict in dicts {
            for word in dict.prefixSearch(lp, limit: limit) {
                if seen.insert(word).inserted {
                    results.append(word)
                    if results.count >= limit { return results }
                }
            }
        }
        return results
    }

    // MARK: - Lookup

    struct DictResult {
        let title: String
        let html: String
        let css: String?          // dict-specific stylesheet, if found
        let dictDirPath: String?  // base URL for relative resource paths
    }

    func lookup(_ word: String) -> [DictResult] {
        dicts.compactMap { dict in
            guard let html = try? dict.lookup(word) else { return nil }
            let dirPath = (dict.filePath as NSString).deletingLastPathComponent
            return DictResult(title: dict.meta.title, html: html, css: dict.css, dictDirPath: dirPath)
        }
    }

    // MARK: - Directory resolution

    // In the iOS Simulator the full macOS filesystem is accessible.
    // On a real device this falls back to the app's Documents/dicts/ directory.
    private static var dictsDirectory: URL {
        #if targetEnvironment(simulator)
        let container = NSHomeDirectory()
        if let range = container.range(of: "/Library/Developer/CoreSimulator/") {
            let macHome = String(container[..<range.lowerBound])
            return URL(fileURLWithPath: macHome + "/.glean/dicts")
        }
        #endif
        return FileManager.default
            .urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("dicts")
    }

    private func findMdx(in dir: URL) -> URL? {
        (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil))?
            .first { $0.pathExtension.lowercased() == "mdx" }
    }
}
