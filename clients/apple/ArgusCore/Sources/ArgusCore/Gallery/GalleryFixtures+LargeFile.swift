import ArgusKit
import Foundation

/// A 3 MB server log for the large-file viewer, paged the way the host pages it.
extension GalleryFixtures {
  public static let previewLargeLog: [UInt8] = {
    let methods = ["files.read", "agents.send", "sessions.list", "git.status", "files.search"]
    var text = ""
    for i in 0..<36_000 {
      let ms = 3 + (i * 37) % 180
      let level = i % 97 == 0 ? "WARN " : "INFO "
      text += "2026-11-26T09:\(String(format: "%02d:%02d", (i / 600) % 60, (i / 10) % 60)).\(String(format: "%03d", i % 1000))Z "
      text += "\(level) gateway  request id=r\(String(i, radix: 16)) method=\(methods[i % methods.count]) \(ms)ms\n"
    }
    return Array(text.utf8)
  }()

  public static func previewLargeRange(offset: Int, length: Int) -> ArgusProtocol.CodeFileRange {
    let bytes = previewLargeLog
    let start = min(offset, bytes.count)
    let slice = bytes[start..<min(bytes.count, start + length)]
    var end = slice.endIndex
    if end < bytes.count, let newline = slice.lastIndex(of: 0x0A) { end = newline + 1 }
    return .init(
      text: String(decoding: bytes[start..<end], as: UTF8.self), offset: start, end: end, size: bytes.count,
      binary: false)
  }

  @MainActor
  public static func previewLargePager() -> LargeFilePager {
    LargeFilePager(size: previewLargeLog.count) { offset, length in previewLargeRange(offset: offset, length: length) }
  }
}
