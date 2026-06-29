import MdxKit
import Observation
import Foundation
import SQLite3

@Observable
final class DictManager: @unchecked Sendable {
    var dicts: [MdxDict] = []
    private var mddDicts: [MddDict] = []
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
        var loadedMdd: [MddDict] = []
        for subdir in subdirs {
            guard let mdxURL = findMdx(in: subdir) else { continue }
            do {
                let dict = try MdxDict(path: mdxURL.path)
                loaded.append(dict)
                print("MdxKit: loaded \(dict.meta.title)")
            } catch {
                print("MdxKit: failed to load \(mdxURL.lastPathComponent): \(error)")
            }
            // Load paired .mdd files in the same directory
            if let mddURLs = try? FileManager.default.contentsOfDirectory(at: subdir, includingPropertiesForKeys: nil)
                .filter({ $0.pathExtension.lowercased() == "mdd" }) {
                for mddURL in mddURLs {
                    if let mdd = try? MddDict(path: mddURL.path) {
                        loadedMdd.append(mdd)
                        print("MdxKit: loaded MDD \(mddURL.lastPathComponent)")
                    }
                }
            }
        }

        dicts = Self.sorted(loaded, using: Self.gleanDbPath)
        mddDicts = loadedMdd
        isReady = true
    }

    // MARK: - Audio

    /// Look up audio data for a sound:// link (e.g. "uk/hello.mp3" or "hello.mp3").
    func audioData(for soundPath: String) -> Data? {
        // MDD keys are like `\hello.mp3` or `\uk\hello.mp3` (backslash-prefixed, backslash-separated)
        let normalized = soundPath.replacingOccurrences(of: "/", with: "\\")
        let key = normalized.hasPrefix("\\") ? normalized : "\\\(normalized)"
        for mdd in mddDicts {
            if let data = try? mdd.lookup(key: key), !data.isEmpty { return data }
            // Also try suffix match (some dicts omit directory prefix)
            if let matchKey = mdd.firstKey(endingWith: "\\\(normalized.components(separatedBy: "\\").last ?? normalized)"),
               let data = try? mdd.lookup(key: matchKey), !data.isEmpty { return data }
        }
        return nil
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

    // MARK: - Sort by macOS glean.db sort_order

    // Read sort_order from ~/.glean/glean.db (keyed by dict directory ID).
    // Falls back to title alphabetical order if the DB is unavailable.
    private static func sorted(_ dicts: [MdxDict], using dbPath: String?) -> [MdxDict] {
        guard let dbPath, let order = readSortOrder(from: dbPath), !order.isEmpty else {
            return dicts.sorted { $0.meta.title < $1.meta.title }
        }
        return dicts.sorted { a, b in
            let idA = URL(fileURLWithPath: a.filePath).deletingLastPathComponent().lastPathComponent
            let idB = URL(fileURLWithPath: b.filePath).deletingLastPathComponent().lastPathComponent
            let sa = order[idA] ?? Int.max
            let sb = order[idB] ?? Int.max
            return sa < sb
        }
    }

    private static func readSortOrder(from dbPath: String) -> [String: Int]? {
        var db: OpaquePointer?
        guard sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_close(db) }

        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT id, sort_order FROM dictionaries", -1, &stmt, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(stmt) }

        var result: [String: Int] = [:]
        while sqlite3_step(stmt) == SQLITE_ROW {
            if let idPtr = sqlite3_column_text(stmt, 0) {
                result[String(cString: idPtr)] = Int(sqlite3_column_int(stmt, 1))
            }
        }
        return result
    }

    private static var gleanDbPath: String? {
        #if targetEnvironment(simulator)
        let container = NSHomeDirectory()
        if let range = container.range(of: "/Library/Developer/CoreSimulator/") {
            return String(container[..<range.lowerBound]) + "/.glean/glean.db"
        }
        #endif
        return nil  // device: no macOS DB, fall back to title sort
    }
}
