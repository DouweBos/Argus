import Foundation

/// Links and text shared into Argus, as the start composer's opening draft:
/// each link on a line of its own, text quoted, then room for the prompt.
public enum SharedPrompt {
  public static func draft(links: [String], texts: [String]) -> String {
    var urls: [String] = []
    var quotes: [String] = []
    for link in links.map(trimmed) where !link.isEmpty && !urls.contains(link) {
      urls.append(link)
    }
    for text in texts.map(trimmed) where !text.isEmpty {
      // Slack and others share a link as plain text.
      if isLink(text) {
        if !urls.contains(text) { urls.append(text) }
      } else if !quotes.contains(text) {
        quotes.append(text)
      }
    }
    let blocks = urls + quotes.map(quote)
    return blocks.isEmpty ? "" : blocks.joined(separator: "\n\n") + "\n\n"
  }

  public static func isLink(_ text: String) -> Bool {
    guard !text.contains(where: \.isWhitespace), let url = URL(string: text), let scheme = url.scheme?.lowercased()
    else { return false }
    return (scheme == "http" || scheme == "https") && url.host != nil
  }

  static func quote(_ text: String) -> String {
    text.split(separator: "\n", omittingEmptySubsequences: false)
      .map { $0.isEmpty ? ">" : "> \($0)" }
      .joined(separator: "\n")
  }

  private static func trimmed(_ text: String) -> String {
    text.trimmingCharacters(in: .whitespacesAndNewlines)
  }
}
