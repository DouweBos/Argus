import Foundation

/// Which transcript rows are built at all. A long chat renders only its tail;
/// reaching the top reveals another page above. Everything outside the window
/// costs nothing on a width change, a stream update or a scroll.
///
/// The window is pinned by the message its first row holds, so new output
/// below and older pages loaded above never shift what the reader is on.
public struct TranscriptWindow: Equatable, Sendable {
  /// Rows revealed per step; a few screens' worth.
  public static let page = 60

  /// The message the first rendered row holds; nil renders the last page.
  public var pinned: String?

  public init(pinned: String? = nil) {
    self.pinned = pinned
  }

  /// Where rendering starts among `segments`: the row holding the pinned
  /// message, or the last page when nothing is pinned or it is gone.
  public func start(_ segments: [ToolGroups.Segment]) -> Int {
    let tail = max(0, segments.count - Self.page)
    guard let pinned else { return tail }
    return segments.firstIndex { $0.holds(pinned) } ?? tail
  }

  /// The rendered rows.
  public func visible(_ segments: [ToolGroups.Segment]) -> ArraySlice<ToolGroups.Segment> {
    segments[start(segments)...]
  }

  /// Rows exist above the window.
  public func hasHidden(_ segments: [ToolGroups.Segment]) -> Bool {
    start(segments) > 0
  }

  /// Reveal another page above.
  public mutating func grow(_ segments: [ToolGroups.Segment]) {
    let from = max(0, start(segments) - Self.page)
    pinned = segments.indices.contains(from) ? segments[from].firstMessageId : pinned
  }

  /// Make sure the row holding `messageId` is rendered, plus a little above it.
  public mutating func include(_ messageId: String, in segments: [ToolGroups.Segment]) {
    guard let index = segments.firstIndex(where: { $0.holds(messageId) }),
      index < start(segments)
    else { return }
    pinned = segments[max(0, index - 4)].firstMessageId
  }

  /// Back to the last page once the window holds more than `limit` rows —
  /// only safe while the reader is at the bottom, where dropping rows above
  /// doesn't move what they see.
  public mutating func trim(_ segments: [ToolGroups.Segment], limit: Int = Self.page * 3) {
    guard segments.count - start(segments) > limit else { return }
    pinned = segments[max(0, segments.count - Self.page)].firstMessageId
  }
}

extension ToolGroups.Segment {
  public var firstMessageId: String? {
    switch self {
    case .single(let message): message.id
    case .collapsed(let messages): messages.first?.id
    }
  }

  public func holds(_ messageId: String) -> Bool {
    switch self {
    case .single(let message): message.id == messageId
    case .collapsed(let messages): messages.contains { $0.id == messageId }
    }
  }
}
