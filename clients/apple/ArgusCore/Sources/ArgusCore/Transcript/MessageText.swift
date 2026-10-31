import Foundation

extension RemoteMessage {
  /// What the bubble shows: the user's own words without the linked-projects
  /// preamble, and no blank blocks.
  public var displayBlocks: [String] {
    if role == .user, let linked = LinkedProjects.parsePreamble(textBlocks.joined(separator: "\n")) {
      return linked.rest.isEmpty ? [] : [linked.rest]
    }
    return textBlocks.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
  }

  /// What Copy puts on the clipboard: the shown blocks a blank line apart; nil when there's no text.
  public var copyText: String? {
    let text = displayBlocks.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }.joined(separator: "\n\n")
    return text.isEmpty ? nil : text
  }

  /// What an edit starts from: the shown text, preamble off.
  public var editableText: String { displayBlocks.joined(separator: "\n\n") }

  /// An edit as it is sent: the linked-projects preamble goes back on as it came off.
  public func resendText(editing edited: String) -> String {
    let joined = textBlocks.joined(separator: "\n")
    guard role == .user, let linked = LinkedProjects.parsePreamble(joined) else { return edited }
    return String(joined.dropLast(linked.rest.count)) + edited
  }
}
