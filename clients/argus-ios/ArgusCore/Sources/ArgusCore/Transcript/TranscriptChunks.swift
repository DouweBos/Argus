import Foundation

/// Groups transcript rows into chunks for a lazy stack. A lazy stack walks
/// every child on each layout pass, so two thousand rows cost a frame;
/// a hundred-odd chunks don't.
///
/// Boundaries come from the row ids themselves (content-defined), so loading an
/// older page or appending a message leaves every other chunk — and its id —
/// untouched, and the scroll position with it.
public enum TranscriptChunks {
  /// About one row in `spread` starts a chunk.
  public static let spread: UInt64 = 12
  /// A run with no natural boundary is cut here.
  public static let maxSize = 40

  /// Index ranges into `ids`, in order, covering every id once.
  public static func ranges(_ ids: [String]) -> [Range<Int>] {
    var result: [Range<Int>] = []
    var start = 0
    for index in ids.indices where index > start {
      if isBoundary(ids[index]) || index - start >= maxSize {
        result.append(start..<index)
        start = index
      }
    }
    if start < ids.count { result.append(start..<ids.count) }
    return result
  }

  static func isBoundary(_ id: String) -> Bool {
    // FNV-1a: `hashValue` is seeded per launch, and boundaries must not move.
    var hash: UInt64 = 0xcbf2_9ce4_8422_2325
    for byte in id.utf8 {
      hash ^= UInt64(byte)
      hash &*= 0x100_0000_01b3
    }
    return hash % spread == 0
  }
}
