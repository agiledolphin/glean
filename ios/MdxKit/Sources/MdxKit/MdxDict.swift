import Foundation

// MARK: - Public types

public struct DictMeta: Sendable {
    public let title: String
    public let description: String
    public let encoding: String
    public let version: Float
    public let encrypted: UInt8

    var isUTF16: Bool {
        let e = encoding.uppercased()
        return e.isEmpty || e == "UTF-16" || e == "UTF16"
    }
    var charWidth: Int { isUTF16 ? 2 : 1 }
}

public enum MdxError: Error {
    case cannotOpenFile
    case headerTooShort
    case unsupportedVersion(Float)
    case unknownCompression
    case decompressFailed
    case truncated(String)
}

// MARK: - MdxDict

public final class MdxDict: Sendable {
    public let meta: DictMeta
    public let filePath: String
    public let css: String?            // dict stylesheet (from .css file or MDD)
    public let js: String?             // dict companion script (from .js file or MDD)
    private let index: [String: UInt64]      // lowercase key → global_offset
    private let sortedKeys: [String]          // sorted for prefix search
    private let recordBlockOffset: UInt64

    public init(path: String) throws {
        self.filePath = path
        guard let fh = FileHandle(forReadingAtPath: path) else { throw MdxError.cannotOpenFile }
        defer { try? fh.close() }

        let (m, _) = try MdxDict.readHeader(fh)
        self.meta = m

        let (idx, rbo) = try MdxDict.readKeyBlocks(fh, meta: m)
        self.index = idx
        self.sortedKeys = idx.keys.sorted()
        self.recordBlockOffset = rbo

        // CSS: external .css file first, then extract from accompanying .mdd
        let dir = (path as NSString).deletingLastPathComponent
        if let cssFile = (try? FileManager.default.contentsOfDirectory(atPath: dir))?
                .first(where: { $0.hasSuffix(".css") }) {
            css = try? String(contentsOfFile: (dir as NSString).appendingPathComponent(cssFile), encoding: .utf8)
        } else {
            let mddPath = (path as NSString).deletingPathExtension.appending(".mdd")
            if FileManager.default.fileExists(atPath: mddPath),
               let mdd = try? MddDict(path: mddPath),
               let cssKey = mdd.firstKey(endingWith: ".css"),
               let data = try? mdd.lookup(key: cssKey) {
                css = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1)
            } else {
                css = nil
            }
        }

        // JS: some dicts (e.g. Oxford, Longman) ship a companion script driving
        // "+ More About" / "Word Origin" style expand-collapse widgets.
        if let jsFile = (try? FileManager.default.contentsOfDirectory(atPath: dir))?
                .first(where: { $0.hasSuffix(".js") }) {
            js = try? String(contentsOfFile: (dir as NSString).appendingPathComponent(jsFile), encoding: .utf8)
        } else {
            let mddPath = (path as NSString).deletingPathExtension.appending(".mdd")
            if FileManager.default.fileExists(atPath: mddPath),
               let mdd = try? MddDict(path: mddPath),
               let jsKey = mdd.firstKey(endingWith: ".js"),
               let data = try? mdd.lookup(key: jsKey) {
                js = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1)
            } else {
                js = nil
            }
        }
    }

    // MARK: - Public API

    public func prefixSearch(_ prefix: String, limit: Int = 50) -> [String] {
        let lp = prefix.lowercased()
        let start = lowerBound(lp)
        var result: [String] = []
        var i = start
        while i < sortedKeys.count && sortedKeys[i].hasPrefix(lp) {
            let k = sortedKeys[i]
            if !isNumericAlias(k) {
                result.append(k)
                if result.count >= limit { break }
            }
            i += 1
        }
        return result
    }

    public func lookup(_ word: String) throws -> String? {
        try lookupResolved(word, depth: 0)
    }

    private func lookupResolved(_ word: String, depth: Int) throws -> String? {
        guard depth < 5 else { return nil }  // guard against redirect loops
        let globalOffset = index[word.lowercased()] ?? index[word]
        guard let globalOffset else { return nil }

        guard let fh = FileHandle(forReadingAtPath: filePath) else { throw MdxError.cannotOpenFile }
        defer { try? fh.close() }

        guard let content = try MdxDict.readRecord(fh,
                                                   recordBlockOffset: recordBlockOffset,
                                                   globalOffset: globalOffset,
                                                   meta: meta) else { return nil }

        // Follow @@@LINK= redirects (e.g. Longman alias entries)
        if content.hasPrefix("@@@LINK=") {
            let target = String(content.dropFirst(8)).trimmingCharacters(in: .whitespacesAndNewlines)
            return try lookupResolved(target, depth: depth + 1)
        }
        return content
    }

    // MARK: - Helpers

    private func lowerBound(_ target: String) -> Int {
        var lo = 0, hi = sortedKeys.count
        while lo < hi {
            let mid = (lo + hi) / 2
            sortedKeys[mid] < target ? (lo = mid + 1) : (hi = mid)
        }
        return lo
    }

    private func isNumericAlias(_ key: String) -> Bool {
        guard let ul = key.lastIndex(of: "_") else { return false }
        let suffix = String(key[key.index(after: ul)...])
        guard !suffix.isEmpty && suffix.allSatisfy(\.isNumber) else { return false }
        return index[String(key[..<ul])] != nil
    }
}

// MARK: - Header

private extension MdxDict {
    static func readHeader(_ fh: FileHandle) throws -> (DictMeta, UInt64) {
        let lenData = try fh.readExact(4)
        let headerLen = Int(lenData.readBEU32(at: 0))
        let headerBytes = try fh.readExact(headerLen)
        let _ = try fh.readExact(4)   // adler32 checksum, skip

        let xml = String(data: headerBytes, encoding: .utf16LittleEndian) ?? ""
        let meta = try parseHeaderXML(xml)
        let offset = try fh.offset()
        return (meta, offset)
    }

    static func parseHeaderXML(_ xml: String) throws -> DictMeta {
        func attr(_ name: String) -> String {
            let pat = "\(name)=\""
            guard let s = xml.range(of: pat) else { return "" }
            let after = xml[s.upperBound...]
            guard let e = after.firstIndex(of: "\"") else { return "" }
            return String(after[..<e])
        }
        let version = Float(attr("GeneratedByEngineVersion")) ?? 2.0
        guard version >= 2.0 else { throw MdxError.unsupportedVersion(version) }
        return DictMeta(
            title: attr("Title"),
            description: attr("Description"),
            encoding: attr("Encoding"),
            version: version,
            encrypted: UInt8(attr("Encrypted")) ?? 0
        )
    }
}

// MARK: - Key blocks

private extension MdxDict {
    static func readKeyBlocks(_ fh: FileHandle, meta: DictMeta) throws -> ([String: UInt64], UInt64) {
        let numBlocks  = try fh.readBEU64()
        let _          = try fh.readBEU64()   // num_entries
        let _          = try fh.readBEU64()   // kb_info_decomp
        let kbInfoSize = try fh.readBEU64()
        let _          = try fh.readBEU64()   // kb_size
        let _          = try fh.readExact(4)  // adler32

        var infoBytes = [UInt8](try fh.readExact(Int(kbInfoSize)))
        if meta.encrypted != 0 { decryptKeyBlockInfo(&infoBytes) }

        let blockInfos = try parseKeyBlockInfo(infoBytes, numBlocks: Int(numBlocks), meta: meta)

        var index = [String: UInt64]()
        index.reserveCapacity(blockInfos.count * 512)

        for info in blockInfos {
            let compressed = try fh.readExact(Int(info.compressedSize))
            let decompressed = try decompressBlock(compressed, expectedSize: Int(info.decompressedSize))
            parseKeyBlockEntries([UInt8](decompressed), meta: meta, into: &index)
        }

        let rbo = try fh.offset()
        return (index, rbo)
    }

    // key = RIPEMD128(data[4..8] ++ LE32(0x3695)); decrypt data[8..]
    static func decryptKeyBlockInfo(_ data: inout [UInt8]) {
        guard data.count >= 9 else { return }
        let keyInput = Array(data[4..<8]) + [0x95, 0x36, 0x00, 0x00]
        let key = RIPEMD128.hash(keyInput)
        var prev: UInt8 = 0x36
        for i in 8..<data.count {
            let orig = data[i]
            let rel = i - 8
            data[i] = orig.rotR4 ^ prev ^ UInt8(rel & 0xFF) ^ key[rel % key.count]
            prev = orig
        }
    }

    struct BlockInfo { let compressedSize: UInt64; let decompressedSize: UInt64 }

    static func parseKeyBlockInfo(_ data: [UInt8], numBlocks: Int, meta: DictMeta) throws -> [BlockInfo] {
        let decompressed: [UInt8]
        guard data.count >= 8 else { throw MdxError.truncated("key block info header") }

        switch data[0] {
        case 0x00:
            decompressed = Array(data[8...])
        case 0x02:
            decompressed = try [UInt8](zlibDecompress(Data(data[8...]))
                                       )
        default:
            throw MdxError.unknownCompression
        }

        let cw = meta.charWidth
        var pos = 0
        var infos = [BlockInfo]()
        infos.reserveCapacity(numBlocks)

        for i in 0..<numBlocks {
            guard pos + 8 <= decompressed.count else { throw MdxError.truncated("block \(i) num_entries") }
            pos += 8   // num_entries (skip)

            guard pos + 2 <= decompressed.count else { throw MdxError.truncated("block \(i) first_key_len") }
            let firstLen = Int(decompressed.readBEU16(at: pos))
            pos += 2 + firstLen * cw + cw   // len field + chars + null

            guard pos + 2 <= decompressed.count else { throw MdxError.truncated("block \(i) last_key_len") }
            let lastLen = Int(decompressed.readBEU16(at: pos))
            pos += 2 + lastLen * cw + cw

            guard pos + 16 <= decompressed.count else { throw MdxError.truncated("block \(i) sizes") }
            let compSize  = decompressed.readBEU64(at: pos);  pos += 8
            let decompSize = decompressed.readBEU64(at: pos); pos += 8

            infos.append(BlockInfo(compressedSize: compSize, decompressedSize: decompSize))
        }
        return infos
    }

    static func parseKeyBlockEntries(_ data: [UInt8], meta: DictMeta, into index: inout [String: UInt64]) {
        var pos = 0
        while pos + 8 <= data.count {
            let offset = data.readBEU64(at: pos); pos += 8

            let key: String
            if meta.isUTF16 {
                var units = [UInt16]()
                while pos + 1 < data.count {
                    let c = UInt16(data[pos]) | (UInt16(data[pos+1]) << 8); pos += 2
                    if c == 0 { break }
                    units.append(c)
                }
                key = String(decoding: units, as: UTF16.self)
            } else {
                let start = pos
                while pos < data.count && data[pos] != 0 { pos += 1 }
                key = decodeBytes(Data(data[start..<pos]), encoding: meta.encoding)
                pos += 1   // skip null terminator
            }

            if !key.isEmpty {
                let lk = key.lowercased()
                if index[lk] == nil { index[lk] = offset }
            }
        }
    }

    static func decodeBytes(_ data: Data, encoding: String) -> String {
        switch encoding.uppercased() {
        case "GBK", "GB2312", "GB18030":
            let nsEnc = CFStringConvertEncodingToNSStringEncoding(
                CFStringEncoding(CFStringEncodings.GB_18030_2000.rawValue))
            return String(data: data, encoding: String.Encoding(rawValue: nsEnc)) ?? ""
        case "BIG5":
            let nsEnc = CFStringConvertEncodingToNSStringEncoding(
                CFStringEncoding(CFStringEncodings.big5.rawValue))
            return String(data: data, encoding: String.Encoding(rawValue: nsEnc)) ?? ""
        default:
            return String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) ?? ""
        }
    }
}

// MARK: - Record blocks

private extension MdxDict {
    static func readRecord(_ fh: FileHandle,
                           recordBlockOffset: UInt64,
                           globalOffset: UInt64,
                           meta: DictMeta) throws -> String? {
        try fh.seek(toOffset: recordBlockOffset)

        let numBlocks = try fh.readBEU64()
        let _ = try fh.readBEU64()   // num_entries
        let _ = try fh.readBEU64()   // rb_info_size
        let _ = try fh.readBEU64()   // rb_size

        var blockInfos = [(comp: UInt64, decomp: UInt64)]()
        blockInfos.reserveCapacity(Int(numBlocks))
        for _ in 0..<numBlocks {
            blockInfos.append((try fh.readBEU64(), try fh.readBEU64()))
        }

        // Walk to find which block contains globalOffset
        var decompAcc: UInt64 = 0
        var targetIdx = blockInfos.count - 1
        for (i, info) in blockInfos.enumerated() {
            if globalOffset < decompAcc + info.decomp { targetIdx = i; break }
            decompAcc += info.decomp
        }

        // Seek past preceding compressed blocks
        let skip = blockInfos[..<targetIdx].reduce(UInt64(0)) { $0 + $1.comp }
        try fh.seek(toOffset: (try fh.offset()) + skip)

        let (compSize, decompSize) = blockInfos[targetIdx]
        let compressed = try fh.readExact(Int(compSize))
        let decompressed = try decompressBlock(compressed, expectedSize: Int(decompSize))

        let start = Int(globalOffset - decompAcc)
        guard start < decompressed.count else { return nil }
        let slice = [UInt8](decompressed[start...])

        if meta.isUTF16 {
            var units = [UInt16]()
            var i = 0
            while i + 1 < slice.count {
                let c = UInt16(slice[i]) | (UInt16(slice[i+1]) << 8); i += 2
                if c == 0 { break }
                units.append(c)
            }
            return String(decoding: units, as: UTF16.self)
        } else {
            let end = slice.firstIndex(of: 0) ?? slice.count
            return decodeBytes(Data(slice[..<end]), encoding: meta.encoding)
        }
    }
}

// MARK: - Block decompression

func decompressBlock(_ data: Data, expectedSize: Int) throws -> Data {
    guard data.count >= 8 else { throw MdxError.decompressFailed }
    let payload = data[data.index(data.startIndex, offsetBy: 8)...]
    switch data[data.startIndex] {
    case 0x00: return Data(payload)
    case 0x02: return try zlibDecompress(Data(payload), expectedSize: expectedSize)
    default:   return Data(payload)   // unknown → pass through
    }
}

// MARK: - Byte utilities

extension UInt8 {
    // rotate right 4 bits
    var rotR4: UInt8 { (self >> 4) | (self << 4) }
}

extension Array where Element == UInt8 {
    func readBEU64(at i: Int) -> UInt64 {
        (UInt64(self[i]) << 56) | (UInt64(self[i+1]) << 48) |
        (UInt64(self[i+2]) << 40) | (UInt64(self[i+3]) << 32) |
        (UInt64(self[i+4]) << 24) | (UInt64(self[i+5]) << 16) |
        (UInt64(self[i+6]) << 8)  |  UInt64(self[i+7])
    }
    func readBEU16(at i: Int) -> UInt16 { (UInt16(self[i]) << 8) | UInt16(self[i+1]) }
}

extension Data {
    func readBEU32(at i: Int) -> UInt32 {
        let b = [UInt8](self)
        return (UInt32(b[i]) << 24) | (UInt32(b[i+1]) << 16) | (UInt32(b[i+2]) << 8) | UInt32(b[i+3])
    }
}

// MARK: - FileHandle helpers

extension FileHandle {
    func readExact(_ count: Int) throws -> Data {
        var result = Data()
        while result.count < count {
            guard let chunk = try read(upToCount: count - result.count), !chunk.isEmpty else {
                throw MdxError.truncated("unexpected EOF")
            }
            result.append(chunk)
        }
        return result
    }

    func readBEU64() throws -> UInt64 {
        let d = try readExact(8)
        let b = [UInt8](d)
        return (UInt64(b[0]) << 56) | (UInt64(b[1]) << 48) | (UInt64(b[2]) << 40) |
               (UInt64(b[3]) << 32) | (UInt64(b[4]) << 24) | (UInt64(b[5]) << 16) |
               (UInt64(b[6]) << 8)  |  UInt64(b[7])
    }
}
