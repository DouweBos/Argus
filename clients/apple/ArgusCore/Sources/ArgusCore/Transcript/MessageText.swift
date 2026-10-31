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
}
