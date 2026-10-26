import ArgusCore
import Foundation

/// Row heights by row id, content revision and width. Only rows near the viewport
/// are measured; the rest answer with their last height or an estimate.
struct TranscriptRowHeights {
  private struct Entry {
    var revision: Int
    var heights: [Int: CGFloat]
    /// The last measured height at any width, the best guess at a new one.
    var last: CGFloat
  }

  private var entries: [String: Entry] = [:]
  private var estimates: [String: (revision: Int, shape: Shape)] = [:]
  /// What the table was last told for each row, to note only real changes.
  private(set) var reported: [String: CGFloat] = [:]

  /// Whole points: text wraps differently a point narrower.
  static func widthKey(_ width: CGFloat) -> Int { Int(width.rounded(.down)) }

  func exact(_ id: String, revision: Int, width: CGFloat) -> CGFloat? {
    guard let entry = entries[id], entry.revision == revision else { return nil }
    return entry.heights[Self.widthKey(width)]
  }

  mutating func store(_ id: String, revision: Int, width: CGFloat, height: CGFloat) {
    var entry = entries[id] ?? Entry(revision: revision, heights: [:], last: height)
    if entry.revision != revision { entry = Entry(revision: revision, heights: [:], last: height) }
    entry.heights[Self.widthKey(width)] = height
    entry.last = height
    entries[id] = entry
  }

  /// A row's live content changed size (an image landed, a card opened).
  mutating func forget(_ id: String) {
    guard var entry = entries[id] else { return }
    entry.heights = [:]
    entries[id] = entry
  }

  mutating func forgetAll() {
    for id in entries.keys { forget(id) }
  }

  mutating func report(_ id: String, _ height: CGFloat) { reported[id] = height }

  /// The height to hand the table before the row is measured at this width.
  mutating func guess(_ id: String, revision: Int, width: CGFloat, row: TranscriptRow) -> CGFloat {
    if let exact = exact(id, revision: revision, width: width) { return exact }
    if let entry = entries[id] { return entry.last }
    guard case .segment(let segment) = row else { return 40 }
    if estimates[id]?.revision != revision { estimates[id] = (revision, Shape(segment)) }
    return estimates[id]!.shape.height(width: width)
  }

  /// Enough of a segment to estimate its height without laying it out.
  private struct Shape {
    var characters = 0
    var lines = 0
    var calls = 0
    var diffLines = 0
    var images = 0
    var badges = false
    var collapsed = false
    /// Your own words sit in a padded bubble, narrower than the column.
    var bubble = false

    init(_ segment: ToolGroups.Segment) {
      if case .collapsed = segment {
        collapsed = true
        return
      }
      for message in segment.messages {
        for block in message.textBlocks {
          characters += block.utf16.count
          lines += block.utf8.count(where: { $0 == 10 }) + 1
        }
        calls += message.toolCalls.count
        for call in message.toolCalls where call.name == "Edit" || call.name == "Write" {
          let text = call.input["new_string"]?.stringValue ?? call.input["content"]?.stringValue ?? ""
          diffLines += min(text.utf8.count(where: { $0 == 10 }) + 1, 60)
        }
        images += (message.images ?? []).isEmpty ? 0 : 1
        badges = badges || message.isError == true || message.source != nil || message.author != nil
        bubble = bubble || message.role == .user
      }
    }

    func height(width: CGFloat) -> CGFloat {
      let spacing: CGFloat = 14
      if collapsed { return 30 + spacing }
      let content = max(min(width, 920) - 40 - (bubble ? 104 : 0), 100)
      let wrapped = CGFloat(characters) * 7 / content
      let text = (CGFloat(lines) + wrapped) * 17
      return spacing + text + CGFloat(calls) * 40 + CGFloat(diffLines) * 15 + CGFloat(images) * 170
        + (badges ? 24 : 0) + (bubble ? 16 : 0)
    }
  }
}
