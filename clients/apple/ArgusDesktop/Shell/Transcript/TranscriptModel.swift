import AppKit
import ArgusCore
import Observation

/// One agent pane's transcript state that isn't the host's: rendered text,
/// find, and which tool groups are open.
@MainActor
@Observable
final class TranscriptModel {
  // MARK: Find

  var findOpen = false
  var query = ""
  private(set) var hits: [TranscriptSearch.Hit] = []
  private(set) var current: Int?
  /// Hits per unit, so a row looks up its own without scanning every hit.
  private(set) var hitsByUnit: [String: [NSRange]] = [:]
  /// Bumped on every step, so the row holding the match scrolls it into view.
  private(set) var revealToken = 0
  /// The last token a text view acted on. Unobserved, and kept here rather
  /// than in the view: the lazy stack recreates rows, and a fresh view must
  /// not scroll back to a match the reader has since moved away from.
  @ObservationIgnored var revealedToken = 0

  /// The token for a row holding the current match, or 0 once it's been shown.
  var pendingReveal: Int { revealedToken >= revealToken ? 0 : revealToken }
  @ObservationIgnored private var navigated = false

  // MARK: Rows

  var expandedGroups: Set<String> = []

  @ObservationIgnored private var rendered: [String: Rendered] = [:]

  private struct Rendered {
    let source: [String]
    let text: NSAttributedString
  }

  var currentHit: TranscriptSearch.Hit? {
    current.flatMap { hits.indices.contains($0) ? hits[$0] : nil }
  }

  // MARK: Rendering

  /// The message's text as one attributed string, cached until its blocks change.
  func text(for message: RemoteMessage) -> NSAttributedString? {
    let blocks = Self.textBlocks(message)
    guard !blocks.isEmpty else { return nil }
    if let cached = rendered[message.id], cached.source == blocks { return cached.text }
    let text =
      message.role == .user
      ? TranscriptMarkdown.render(userText: blocks.joined(separator: "\n\n"))
      : TranscriptMarkdown.render(markdown: blocks.joined(separator: "\n\n"))
    rendered[message.id] = Rendered(source: blocks, text: text)
    return text
  }

  /// What the bubble shows: the user's own words without the linked-projects
  /// preamble, and no blank blocks.
  static func textBlocks(_ message: RemoteMessage) -> [String] {
    if message.role == .user,
      let linked = LinkedProjects.parsePreamble(message.textBlocks.joined(separator: "\n"))
    {
      return linked.rest.isEmpty ? [] : [linked.rest]
    }
    return message.textBlocks.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
  }

  static func textUnit(_ messageId: String) -> String { "m:\(messageId)" }
  static func toolUnit(_ messageId: String, _ callId: String) -> String { "t:\(messageId):\(callId)" }

  static func toolSummary(_ call: RemoteToolCall) -> String {
    let name =
      call.name == "Agent" ? call.input["subagent_type"]?.stringValue ?? call.name : call.name
    return "\(name) \(ToolCallSummary.summary(name: call.name, input: call.input))"
  }

  // MARK: Find

  /// Re-runs the query over `messages`, keeping the current match where it
  /// still exists so new output doesn't yank the reader to the first hit.
  ///
  /// Messages not rendered yet are rendered in batches with the run loop
  /// turning between them, so the first search of a long transcript never
  /// freezes the window. A newer query cancels this one.
  func search(_ messages: [RemoteMessage]) async {
    var units: [TranscriptSearch.Unit] = []
    units.reserveCapacity(messages.count * 2)
    if !query.trimmingCharacters(in: .whitespaces).isEmpty {
      for (index, message) in messages.enumerated() {
        if index % 100 == 99 {
          try? await Task.sleep(for: .milliseconds(1))
          if Task.isCancelled { return }
        }
        if let text = text(for: message) {
          units.append(.init(id: Self.textUnit(message.id), text: text.string))
        }
        for call in message.toolCalls {
          units.append(.init(id: Self.toolUnit(message.id, call.id), text: Self.toolSummary(call)))
        }
      }
    }
    let previous = currentHit
    let found = TranscriptSearch.find(query, in: units)
    hits = found
    hitsByUnit = Dictionary(grouping: found, by: \.unitId).mapValues { $0.map(\.range) }
    if let previous, let index = found.firstIndex(of: previous) {
      current = index
    } else {
      // Start from the newest match: the reader is at the bottom.
      current = found.isEmpty ? nil : found.count - 1
      revealToken += 1
    }
  }

  func step(forward: Bool) {
    current = TranscriptSearch.step(from: current, count: hits.count, forward: forward)
    navigated = true
    revealToken += 1
  }

  /// Bumped by ⌘F, so pressing it with the bar already open refocuses the field.
  private(set) var findFocusToken = 0

  func openFind() {
    findOpen = true
    findFocusToken += 1
  }

  func closeFind() {
    guard findOpen else { return }
    if !query.trimmingCharacters(in: .whitespaces).isEmpty {
      MacTelemetry.capture(
        .transcriptFindUsed(matches: Self.bucket(hits.count), navigated: navigated))
    }
    findOpen = false
    query = ""
    hits = []
    hitsByUnit = [:]
    current = nil
    navigated = false
  }

  private static func bucket(_ count: Int) -> String {
    switch count {
    case 0: "0"
    case 1..<10: "1-9"
    case 10..<100: "10-99"
    default: "100+"
    }
  }
}
