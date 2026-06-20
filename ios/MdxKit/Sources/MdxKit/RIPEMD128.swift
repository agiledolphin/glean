import Foundation

// RIPEMD-128 per https://homes.esat.kuleuven.be/~bosselae/ripemd160/pdf/AB-9601/AB-9601.pdf
// Known vectors:
//   ""    → cdf26213a150dc3ecb610f18f6b38b46
//   "abc" → c14a12199c66e4ba84636b0f69144c77
public enum RIPEMD128 {

    // MARK: - Round tables

    // Left lane message selection
    private static let rl: [Int] = [
        0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,
        7,4,13,1,10,6,15,3,12,0,9,5,2,14,11,8,
        3,10,14,4,9,15,8,1,2,7,0,6,13,11,5,12,
        1,9,11,10,0,8,12,4,13,3,7,15,14,5,6,2
    ]
    // Right lane message selection
    private static let rr: [Int] = [
        5,14,7,0,9,2,11,4,13,6,15,8,1,10,3,12,
        6,11,3,7,0,13,5,10,14,15,8,12,4,9,1,2,
        15,5,1,3,7,14,6,9,11,8,12,2,10,0,4,13,
        8,6,4,1,3,11,15,0,5,12,2,13,9,7,10,14
    ]
    // Left lane rotation amounts
    private static let sl: [UInt32] = [
        11,14,15,12,5,8,7,9,11,13,14,15,6,7,9,8,
        7,6,8,13,11,9,7,15,7,12,15,9,11,7,13,12,
        11,13,6,7,14,9,13,15,14,8,13,6,5,12,7,5,
        11,12,14,15,14,15,9,8,9,14,5,6,8,6,5,12
    ]
    // Right lane rotation amounts
    private static let sr: [UInt32] = [
        8,9,9,11,13,15,15,5,7,7,8,11,14,14,12,6,
        9,13,15,7,12,8,9,11,7,7,12,7,6,15,13,11,
        9,7,15,11,8,6,6,14,12,13,5,14,13,13,7,5,
        15,5,8,11,14,14,6,14,6,9,12,9,12,5,15,8
    ]
    // Per-round additive constants
    private static let kl: [UInt32] = [0x00000000, 0x5A827999, 0x6ED9EBA1, 0x8F1BBCDC]
    private static let kr: [UInt32] = [0x50A28BE6, 0x5C4DD124, 0x6D703EF3, 0x00000000]

    // MARK: - Boolean functions

    private static func f1(_ x: UInt32, _ y: UInt32, _ z: UInt32) -> UInt32 { x ^ y ^ z }
    private static func f2(_ x: UInt32, _ y: UInt32, _ z: UInt32) -> UInt32 { (x & y) | (~x & z) }
    private static func f3(_ x: UInt32, _ y: UInt32, _ z: UInt32) -> UInt32 { (x | ~y) ^ z }
    private static func f4(_ x: UInt32, _ y: UInt32, _ z: UInt32) -> UInt32 { (x & z) | (y & ~z) }

    // Left lane: f1→f2→f3→f4;  Right lane: f4→f3→f2→f1
    private static func fl(_ j: Int, _ x: UInt32, _ y: UInt32, _ z: UInt32) -> UInt32 {
        switch j >> 4 {
        case 0: return f1(x, y, z)
        case 1: return f2(x, y, z)
        case 2: return f3(x, y, z)
        default: return f4(x, y, z)
        }
    }
    private static func fr(_ j: Int, _ x: UInt32, _ y: UInt32, _ z: UInt32) -> UInt32 {
        switch j >> 4 {
        case 0: return f4(x, y, z)
        case 1: return f3(x, y, z)
        case 2: return f2(x, y, z)
        default: return f1(x, y, z)
        }
    }

    @inline(__always)
    private static func rol(_ x: UInt32, _ n: UInt32) -> UInt32 { (x << n) | (x >> (32 - n)) }

    // MARK: - Hash

    public static func hash(_ input: [UInt8]) -> [UInt8] {
        var msg = input

        // MD-padding
        let origLen = msg.count
        msg.append(0x80)
        while msg.count % 64 != 56 { msg.append(0x00) }
        var bitLen = UInt64(origLen) * 8
        for _ in 0..<8 { msg.append(UInt8(bitLen & 0xFF)); bitLen >>= 8 }

        // Initial state
        var h0: UInt32 = 0x67452301
        var h1: UInt32 = 0xEFCDAB89
        var h2: UInt32 = 0x98BADCFE
        var h3: UInt32 = 0x10325476

        // Process 64-byte blocks
        let blockCount = msg.count / 64
        for blk in 0..<blockCount {
            var X = [UInt32](repeating: 0, count: 16)
            let base = blk * 64
            for i in 0..<16 {
                let b = base + i * 4
                X[i] = UInt32(msg[b]) | (UInt32(msg[b+1]) << 8) |
                        (UInt32(msg[b+2]) << 16) | (UInt32(msg[b+3]) << 24)
            }

            var (A, B, C, D)     = (h0, h1, h2, h3)  // left lane
            var (AA, BB, CC, DD) = (h0, h1, h2, h3)  // right lane

            for j in 0..<64 {
                let T = rol(A &+ fl(j, B, C, D) &+ X[rl[j]] &+ kl[j >> 4], sl[j])
                A = D; D = C; C = B; B = T

                let TT = rol(AA &+ fr(j, BB, CC, DD) &+ X[rr[j]] &+ kr[j >> 4], sr[j])
                AA = DD; DD = CC; CC = BB; BB = TT
            }

            // Combine parallel lanes
            let T = h1 &+ C &+ DD
            h1 = h2 &+ D &+ AA
            h2 = h3 &+ A &+ BB
            h3 = h0 &+ B &+ CC
            h0 = T
        }

        // Output as 4 × little-endian UInt32
        func le32(_ v: UInt32, into out: inout [UInt8], at i: Int) {
            out[i]   = UInt8(v & 0xFF)
            out[i+1] = UInt8((v >> 8) & 0xFF)
            out[i+2] = UInt8((v >> 16) & 0xFF)
            out[i+3] = UInt8((v >> 24) & 0xFF)
        }
        var result = [UInt8](repeating: 0, count: 16)
        le32(h0, into: &result, at: 0)
        le32(h1, into: &result, at: 4)
        le32(h2, into: &result, at: 8)
        le32(h3, into: &result, at: 12)
        return result
    }

    public static func hash(_ data: Data) -> [UInt8] { hash([UInt8](data)) }
}
