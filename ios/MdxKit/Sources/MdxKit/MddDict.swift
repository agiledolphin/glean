/// MDD binary resource parser — same block structure as MDX.
/// Keys are file paths (e.g. `\collinsEC.css`); values are raw binary data.

import Foundation

public final class MddDict: Sendable {
    public let filePath: String
    private let index: [String: UInt64]          // lowercase key → global_offset
    private let sortedOffsets: [(UInt64, String)] // sorted by offset for range lookups
    private let recordBlockOffset: UInt64
    private let encoding: String
    private let encrypted: UInt8

    public init(path: String) throws {
        self.filePath = path
        guard let fh = FileHandle(forReadingAtPath: path) else { throw MdxError.cannotOpenFile }
        defer { try? fh.close() }

        let (enc, encFlag) = try MddDict.readHeader(fh)
        self.encoding = enc
        self.encrypted = encFlag

        let (idx, rbo) = try MddDict.readKeyBlocks(fh, encoding: enc, encrypted: encFlag)
        self.index = idx
        self.sortedOffsets = idx.map { ($0.value, $0.key) }.sorted { $0.0 < $1.0 }
        self.recordBlockOffset = rbo
    }

    // MARK: - Public API

    public func keys() -> [String] { Array(index.keys) }

    public func lookup(key: String) throws -> Data? {
        let lower = key.lowercased()
        guard let globalOffset = index[lower] else { return nil }

        // Find next offset to bound this record's end within its block
        let nextGlobal = nextOffset(after: globalOffset)

        guard let fh = FileHandle(forReadingAtPath: filePath) else { throw MdxError.cannotOpenFile }
        defer { try? fh.close() }

        return try MddDict.readBinaryRecord(fh, recordBlockOffset: recordBlockOffset,
                                            globalOffset: globalOffset, nextGlobal: nextGlobal)
    }

    /// Find the first key whose path ends with the given suffix (case-insensitive).
    public func firstKey(endingWith suffix: String) -> String? {
        let lower = suffix.lowercased()
        return index.keys.first { $0.hasSuffix(lower) }
    }

    // MARK: - Helpers

    private func nextOffset(after target: UInt64) -> UInt64? {
        var lo = 0, hi = sortedOffsets.count
        while lo < hi {
            let mid = (lo + hi) / 2
            sortedOffsets[mid].0 <= target ? (lo = mid + 1) : (hi = mid)
        }
        return lo < sortedOffsets.count ? sortedOffsets[lo].0 : nil
    }
}

// MARK: - Header

private extension MddDict {
    // MDD header is identical in layout to MDX; we only need Encoding + Encrypted.
    static func readHeader(_ fh: FileHandle) throws -> (String, UInt8) {
        let lenData = try fh.readExact(4)
        let headerLen = Int(lenData.readBEU32(at: 0))
        let headerBytes = try fh.readExact(headerLen)
        let _ = try fh.readExact(4) // checksum

        let xml = String(data: headerBytes, encoding: .utf16LittleEndian) ?? ""
        func attr(_ name: String) -> String {
            let pat = "\(name)=\""
            guard let s = xml.range(of: pat) else { return "" }
            let after = xml[s.upperBound...]
            guard let e = after.firstIndex(of: "\"") else { return "" }
            return String(after[..<e])
        }
        let enc = attr("Encoding")
        let encFlag = UInt8(attr("Encrypted")) ?? 0
        return (enc, encFlag)
    }
}

// MARK: - Key blocks (identical structure to MDX)

private extension MddDict {
    struct BlockInfo { let compressedSize: UInt64; let decompressedSize: UInt64 }

    static func readKeyBlocks(_ fh: FileHandle, encoding: String, encrypted: UInt8) throws -> ([String: UInt64], UInt64) {
        let numBlocks  = try fh.readBEU64()
        let _          = try fh.readBEU64()
        let _          = try fh.readBEU64()
        let kbInfoSize = try fh.readBEU64()
        let _          = try fh.readBEU64()
        let _          = try fh.readExact(4) // adler32

        var infoBytes = [UInt8](try fh.readExact(Int(kbInfoSize)))
        if encrypted != 0 { decryptKeyBlockInfo(&infoBytes) }

        let isUTF16: Bool = {
            let e = encoding.uppercased()
            return e.isEmpty || e == "UTF-16" || e == "UTF16"
        }()
        let cw = isUTF16 ? 2 : 1
        let blockInfos = try parseBlockInfos(infoBytes, numBlocks: Int(numBlocks), cw: cw)

        var index = [String: UInt64]()
        for info in blockInfos {
            let compressed = try fh.readExact(Int(info.compressedSize))
            let data = try decompressBlock(compressed, expectedSize: Int(info.decompressedSize))
            parseEntries([UInt8](data), isUTF16: isUTF16, encoding: encoding, into: &index)
        }

        let rbo = try fh.offset()
        return (index, rbo)
    }

    static func decryptKeyBlockInfo(_ data: inout [UInt8]) {
        guard data.count >= 9 else { return }
        let keyInput = Array(data[4..<8]) + [0x95, 0x36, 0x00, 0x00]
        let key = RIPEMD128.hash(keyInput)
        var prev: UInt8 = 0x36
        for i in 8..<data.count {
            let orig = data[i]
            data[i] = orig.rotR4 ^ prev ^ UInt8((i - 8) & 0xFF) ^ key[(i - 8) % key.count]
            prev = orig
        }
    }

    static func parseBlockInfos(_ data: [UInt8], numBlocks: Int, cw: Int) throws -> [BlockInfo] {
        guard data.count >= 8 else { throw MdxError.truncated("mdd key block info header") }
        let decompressed: [UInt8]
        switch data[0] {
        case 0x00: decompressed = Array(data[8...])
        case 0x02: decompressed = try [UInt8](zlibDecompress(Data(data[8...])))
        default:   throw MdxError.unknownCompression
        }

        var pos = 0
        var infos = [BlockInfo]()
        for _ in 0..<numBlocks {
            guard pos + 8 <= decompressed.count else { throw MdxError.truncated("mdd block infos") }
            pos += 8
            guard pos + 2 <= decompressed.count else { throw MdxError.truncated("mdd first key len") }
            let flen = Int(decompressed.readBEU16(at: pos)); pos += 2 + flen * cw + cw
            guard pos + 2 <= decompressed.count else { throw MdxError.truncated("mdd last key len") }
            let llen = Int(decompressed.readBEU16(at: pos)); pos += 2 + llen * cw + cw
            guard pos + 16 <= decompressed.count else { throw MdxError.truncated("mdd block sizes") }
            let comp  = decompressed.readBEU64(at: pos); pos += 8
            let decomp = decompressed.readBEU64(at: pos); pos += 8
            infos.append(BlockInfo(compressedSize: comp, decompressedSize: decomp))
        }
        return infos
    }

    static func parseEntries(_ data: [UInt8], isUTF16: Bool, encoding: String, into index: inout [String: UInt64]) {
        var pos = 0
        while pos + 8 <= data.count {
            let offset = data.readBEU64(at: pos); pos += 8
            let key: String
            if isUTF16 {
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
                key = String(data: Data(data[start..<pos]), encoding: .utf8) ?? ""
                pos += 1
            }
            if !key.isEmpty {
                let lk = key.lowercased()
                if index[lk] == nil { index[lk] = offset }
            }
        }
    }
}

// MARK: - Record reading

private extension MddDict {
    static func readBinaryRecord(_ fh: FileHandle,
                                 recordBlockOffset: UInt64,
                                 globalOffset: UInt64,
                                 nextGlobal: UInt64?) throws -> Data? {
        try fh.seek(toOffset: recordBlockOffset)

        let numBlocks = try fh.readBEU64()
        let _ = try fh.readBEU64()
        let _ = try fh.readBEU64()
        let _ = try fh.readBEU64()

        var blockInfos = [(comp: UInt64, decomp: UInt64)]()
        for _ in 0..<numBlocks {
            blockInfos.append((try fh.readBEU64(), try fh.readBEU64()))
        }

        var decompAcc: UInt64 = 0
        var targetIdx = blockInfos.count - 1
        for (i, info) in blockInfos.enumerated() {
            if globalOffset < decompAcc + info.decomp { targetIdx = i; break }
            decompAcc += info.decomp
        }

        let skip = blockInfos[..<targetIdx].reduce(UInt64(0)) { $0 + $1.comp }
        try fh.seek(toOffset: (try fh.offset()) + skip)

        let (compSize, decompSize) = blockInfos[targetIdx]
        let compressed = try fh.readExact(Int(compSize))
        let decompressed = try decompressBlock(compressed, expectedSize: Int(decompSize))

        let start = Int(globalOffset - decompAcc)
        guard start < decompressed.count else { return nil }

        // End: next entry within this block, or block end
        let blockEnd = decompAcc + UInt64(decompressed.count)
        let end: Int
        if let next = nextGlobal, next < blockEnd {
            end = Int(next - decompAcc)
        } else {
            end = decompressed.count
        }

        guard start < end else { return nil }
        return Data(decompressed[start..<end])
    }
}

