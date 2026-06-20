import Testing
@testable import MdxKit

@Suite("RIPEMD-128")
struct RIPEMD128Tests {

    private func hex(_ bytes: [UInt8]) -> String {
        bytes.map { String(format: "%02x", $0) }.joined()
    }

    @Test func emptyString() {
        let result = hex(RIPEMD128.hash([]))
        #expect(result == "cdf26213a150dc3ecb610f18f6b38b46")
    }

    @Test func abc() {
        let result = hex(RIPEMD128.hash(Array("abc".utf8)))
        #expect(result == "c14a12199c66e4ba84636b0f69144c77")
    }

    @Test func messageDigest() {
        let result = hex(RIPEMD128.hash(Array("message digest".utf8)))
        #expect(result == "9e327b3d6e523062afc1132d7df9d1b8")
    }

    @Test func alphabetLower() {
        let result = hex(RIPEMD128.hash(Array("abcdefghijklmnopqrstuvwxyz".utf8)))
        #expect(result == "fd2aa607f71dc8f510714922b371834e")
    }
}
