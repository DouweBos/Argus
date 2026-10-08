import Foundation

/// A chat's tool-group segments, regrouped only around what changed, so a stream
/// update or an older page costs the segments at that edge. Matches
/// `ToolGroups.group` exactly; `update` says which segments changed.
public struct TranscriptSegments: Sendable {
  public private(set) var messages: [RemoteMessage] = []
  public private(set) var segments: [ToolGroups.Segment] = []
  /// Index in `messages` of each segment's first message.
  private var starts: [Int] = []
  private let hoistImageReads: Bool

  public init(hoistImageReads: Bool = false) {
    self.hoistImageReads = hoistImageReads
  }

  /// What `update` replaced: `removed` in the old segments became `inserted`
  /// in the new ones, and `reloaded` (new indices) kept their id but changed.
  public struct Change: Equatable, Sendable {
    public var removed: Range<Int>
    public var inserted: Range<Int>
    public var reloaded: [Int]

    public init(removed: Range<Int>, inserted: Range<Int>, reloaded: [Int]) {
      self.removed = removed
      self.inserted = inserted
      self.reloaded = reloaded
    }

    public var isEmpty: Bool { removed.isEmpty && inserted.isEmpty && reloaded.isEmpty }

    static let none = Change(removed: 0..<0, inserted: 0..<0, reloaded: [])
  }

  @discardableResult
  public mutating func update(_ new: [RemoteMessage]) -> Change {
    let old = messages
    var prefix = 0
    let shorter = min(old.count, new.count)
    while prefix < shorter, old[prefix].id == new[prefix].id, old[prefix] == new[prefix] { prefix += 1 }
    if prefix == old.count, prefix == new.count { return .none }
    var suffix = 0
    while suffix < shorter - prefix, old[old.count - 1 - suffix].id == new[new.count - 1 - suffix].id,
      old[old.count - 1 - suffix] == new[new.count - 1 - suffix]
    {
      suffix += 1
    }
    messages = new

    guard !segments.isEmpty, !old.isEmpty else {
      let (built, builtStarts) = group(new, 0..<new.count)
      let removed = 0..<segments.count
      segments = built
      starts = builtStarts
      return Change(removed: removed, inserted: 0..<built.count, reloaded: [])
    }

    // The segments either side of the change, widened over neighbouring
    // tool-only runs a changed message could join or split.
    var first = segment(containing: max(0, prefix - 1))
    var last = segment(containing: min(old.count - 1, old.count - suffix))
    while first > 0, isToolRun(segments[first - 1]) { first -= 1 }
    while last < segments.count - 1, isToolRun(segments[last + 1]) { last += 1 }
    let oldStart = first == 0 ? 0 : starts[first]
    let oldEnd = last + 1 < starts.count ? starts[last + 1] : old.count
    let delta = new.count - old.count
    let (built, builtStarts) = group(new, oldStart..<(oldEnd + delta))

    let replaced = Array(segments[first...last])
    segments.replaceSubrange(first...last, with: built)
    starts.replaceSubrange(first...last, with: builtStarts)
    if delta != 0 {
      for index in (first + built.count)..<starts.count { starts[index] += delta }
    }
    return Self.change(old: replaced, new: built, at: first)
  }

  /// Index of the segment holding `messageId`, if a visible one does.
  public func segmentIndex(holding messageId: String) -> Int? {
    guard let position = messages.firstIndex(where: { $0.id == messageId }) else { return nil }
    let index = segment(containing: position)
    return segments.indices.contains(index) && segments[index].holds(messageId) ? index : nil
  }

  // MARK: Grouping

  /// The segment whose span covers message `index`; invisible messages belong
  /// to the segment before them.
  private func segment(containing index: Int) -> Int {
    var low = 0
    var high = starts.count - 1
    while low < high {
      let mid = (low + high + 1) / 2
      if starts[mid] <= index { low = mid } else { high = mid - 1 }
    }
    return low
  }

  private func isToolRun(_ segment: ToolGroups.Segment) -> Bool {
    switch segment {
    case .collapsed: true
    case .single(let message): ToolGroups.isToolCallOnly(message, hoistImageReads: hoistImageReads)
    }
  }

  /// `ToolGroups.group` over `range`, with each segment's first index.
  private func group(_ messages: [RemoteMessage], _ range: Range<Int>) -> ([ToolGroups.Segment], [Int]) {
    var segments: [ToolGroups.Segment] = []
    var starts: [Int] = []
    var run: [(Int, RemoteMessage)] = []

    func flush() {
      guard !run.isEmpty else { return }
      if run.count >= ToolGroups.minRun {
        segments.append(.collapsed(run.map(\.1)))
        starts.append(run[0].0)
      } else {
        for (index, message) in run {
          segments.append(.single(message))
          starts.append(index)
        }
      }
      run = []
    }

    for index in range {
      let message = messages[index]
      guard ToolGroups.hasVisibleContent(message) else { continue }
      if ToolGroups.isToolCallOnly(message, hoistImageReads: hoistImageReads) {
        run.append((index, message))
      } else {
        flush()
        segments.append(.single(message))
        starts.append(index)
      }
    }
    flush()
    return (segments, starts)
  }

  /// Trims the ids both blocks share at either end, so a stream update to the
  /// last message is one reload rather than a remove and an insert.
  private static func change(old: [ToolGroups.Segment], new: [ToolGroups.Segment], at offset: Int) -> Change {
    var head = 0
    while head < old.count, head < new.count, old[head].id == new[head].id { head += 1 }
    var tail = 0
    while tail < old.count - head, tail < new.count - head,
      old[old.count - 1 - tail].id == new[new.count - 1 - tail].id
    {
      tail += 1
    }
    let kept = Array(0..<head) + Array((new.count - tail)..<new.count)
    let reloaded = kept.filter { index in
      let before = old[index < head ? index : index - new.count + old.count]
      return before.messages != new[index].messages
    }
    return Change(
      removed: (offset + head)..<(offset + old.count - tail),
      inserted: (offset + head)..<(offset + new.count - tail),
      reloaded: reloaded.map { $0 + offset })
  }
}

extension ToolGroups.Segment {
  public var messages: [RemoteMessage] {
    switch self {
    case .single(let message): [message]
    case .collapsed(let messages): messages
    }
  }

  public var firstMessageId: String? { messages.first?.id }

  public func holds(_ messageId: String) -> Bool {
    switch self {
    case .single(let message): message.id == messageId
    case .collapsed(let messages): messages.contains { $0.id == messageId }
    }
  }
}
