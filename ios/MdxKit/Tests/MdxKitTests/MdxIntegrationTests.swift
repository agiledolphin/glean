import Testing
@testable import MdxKit
import Foundation

private let oxfordPath  = "\(NSHomeDirectory())/.glean/dicts/b26b43dd3128d23d/牛津高阶英汉双解词典（第10版）V3.mdx"
private let collinsPath = "\(NSHomeDirectory())/.glean/dicts/2c9ed56b750bde15/Collins COBUILD (CN).mdx"
private let longmanPath = "\(NSHomeDirectory())/.glean/dicts/8a3caffd8771aeb6/LDOCE6EC.mdx"

@Suite("MdxIntegration", .enabled(if: FileManager.default.fileExists(atPath: oxfordPath)))
struct MdxIntegrationTests {

    @Test func openDict() throws {
        let dict = try MdxDict(path: oxfordPath)
        #expect(!dict.meta.title.isEmpty)
        print("title:", dict.meta.title, "encrypted:", dict.meta.encrypted)
    }

    @Test func prefixSearch() throws {
        let dict = try MdxDict(path: oxfordPath)
        let results = dict.prefixSearch("euph", limit: 10)
        print("prefix 'euph':", results)
        #expect(!results.isEmpty)
    }

    @Test func lookupWord() throws {
        let dict = try MdxDict(path: oxfordPath)
        let html = try dict.lookup("euphoria")
        #expect(html != nil)
        print("euphoria (\(html!.count) chars):", html!.prefix(200))
    }

    @Test func lookupMissing() throws {
        let dict = try MdxDict(path: oxfordPath)
        #expect(try dict.lookup("xyzzy_not_a_word_12345") == nil)
    }

    @Test func collinsStory() throws {
        guard FileManager.default.fileExists(atPath: collinsPath) else { return }
        let dict = try MdxDict(path: collinsPath)
        print("Collins css:", dict.css.map { "\($0.count) chars" } ?? "nil")
        let html = try dict.lookup("story")
        print("Collins story (\(html?.count ?? 0) chars):", html?.prefix(200) ?? "nil")
    }

    @Test func longmanStory() throws {
        guard FileManager.default.fileExists(atPath: longmanPath) else { return }
        let dict = try MdxDict(path: longmanPath)
        print("prefix 'story':", dict.prefixSearch("story", limit: 20))
        let html  = try dict.lookup("story")
        let html1 = try dict.lookup("story_1")
        let html2 = try dict.lookup("story_2")
        print("story  (\(html?.count  ?? 0) chars):", html?.prefix(80)  ?? "nil")
        print("story_1(\(html1?.count ?? 0) chars):", html1?.prefix(80) ?? "nil")
        print("story_2(\(html2?.count ?? 0) chars):", html2?.prefix(80) ?? "nil")
    }
}
