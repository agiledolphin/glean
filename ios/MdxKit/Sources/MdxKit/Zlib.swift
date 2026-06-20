import zlib
import Foundation

enum ZlibError: Error {
    case initFailed
    case streamError(Int32)
}

// Decompress zlib-format data (0x78 header, adler32 checksum).
// MDX passes the full zlib stream starting at block_data[8..].
func zlibDecompress(_ compressed: Data, expectedSize: Int = 0) throws -> Data {
    var src = [UInt8](compressed)
    var result = Data(capacity: expectedSize > 0 ? expectedSize : max(src.count * 4, 65536))

    try src.withUnsafeMutableBufferPointer { srcPtr in
        var stream = z_stream()
        stream.next_in  = srcPtr.baseAddress
        stream.avail_in = uInt(srcPtr.count)

        guard inflateInit_(&stream, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else {
            throw ZlibError.initFailed
        }
        defer { inflateEnd(&stream) }

        var outBuf = [UInt8](repeating: 0, count: 65536)
        var status = Z_OK

        repeat {
            let produced = outBuf.withUnsafeMutableBufferPointer { outPtr -> Int in
                stream.next_out  = outPtr.baseAddress
                stream.avail_out = uInt(outPtr.count)
                status = inflate(&stream, Z_SYNC_FLUSH)
                return outPtr.count - Int(stream.avail_out)
            }
            if produced > 0 { result.append(contentsOf: outBuf.prefix(produced)) }
            if status == Z_STREAM_ERROR || status == Z_DATA_ERROR || status == Z_MEM_ERROR {
                throw ZlibError.streamError(status)
            }
        } while stream.avail_out == 0
    }

    return result
}
