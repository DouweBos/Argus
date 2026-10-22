import SwiftUI

/// Replies the user might send next, suggested by the host once a turn ends:
/// a row of chips while the input is empty, ghost text completing a typed
/// prefix, and Tab to take either. Picking one fills the input, never sends.
public enum FollowUps {
  /// The rest of the suggestion `text` is a prefix of, or nil when the input
  /// is empty, matches nothing, or already says it all.
  public static func completion(for text: String, in items: [String]) -> String? {
    guard !text.trimmingCharacters(in: .whitespaces).isEmpty, !text.contains("\n") else {
      return nil
    }
    let match = items.first {
      $0.count > text.count && $0.lowercased().hasPrefix(text.lowercased())
    }
    return match.map { String($0.dropFirst(text.count)) }
  }

  /// What Tab fills the input with: the completion, or the first suggestion
  /// into an empty input.
  public static func accepted(for text: String, in items: [String]) -> String? {
    if let rest = completion(for: text, in: items) { return text + rest }
    if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return items.first }
    return nil
  }
}

/// The chips above the input.
struct FollowUpSuggestionRow: View {
  @Environment(\.theme) private var theme
  let items: [String]
  let pick: (String) -> Void

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 6) {
        ForEach(items, id: \.self) { item in
          Chip(label: item, icon: Icon.reply) { pick(item) }
            .accessibilityHint("Fills the message field")
        }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Suggested replies")
  }
}
