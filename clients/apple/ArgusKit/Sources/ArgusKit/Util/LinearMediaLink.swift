import Foundation

/// A Linear upload (screenshot or screen recording) written on a line of its own,
/// which an issue page shows inline instead of as a link.
public struct LinearMediaLink: Equatable, Sendable {
  public enum Kind: Equatable, Sendable {
    case image
    case video
  }

  public let kind: Kind
  public let url: String
  public let label: String

  /// Part of a paragraph: plain markdown, or an upload to embed.
  public enum Segment: Equatable, Sendable {
    case text(String)
    case media(LinearMediaLink)
  }

  private static let videoExtensions: Set<String> = ["mov", "mp4", "m4v", "webm"]

  public static func isLinearUpload(_ url: String) -> Bool {
    URL(string: url)?.host?.lowercased() == "uploads.linear.app"
  }

  /// `![label](url)` or `[label](url)` filling the whole line, when it's a Linear upload
  /// Argus can show: any image, and links whose text or path names a video.
  public static func parse(line: String) -> LinearMediaLink? {
    var rest = Substring(line.trimmingCharacters(in: .whitespaces))
    let isImage = rest.hasPrefix("!")
    if isImage { rest = rest.dropFirst() }
    guard rest.hasPrefix("["), rest.hasSuffix(")"), let close = rest.range(of: "](") else { return nil }
    let label = String(rest[rest.index(after: rest.startIndex)..<close.lowerBound])
    guard !label.contains("]") else { return nil }
    var target = rest[close.upperBound..<rest.index(before: rest.endIndex)]
      .trimmingCharacters(in: .whitespaces)
    // An optional `"title"` after the URL.
    if let space = target.firstIndex(of: " ") { target = String(target[..<space]) }
    guard isLinearUpload(target) else { return nil }
    if isImage { return LinearMediaLink(kind: .image, url: target, label: label) }
    let path = URL(string: target)?.path ?? ""
    let named = [label, path].contains { videoExtensions.contains(($0 as NSString).pathExtension.lowercased()) }
    return named ? LinearMediaLink(kind: .video, url: target, label: label) : nil
  }

  /// Splits a paragraph around its upload lines; a paragraph without any is one text segment.
  public static func segments(_ paragraph: String) -> [Segment] {
    var segments: [Segment] = []
    var text: [String] = []
    func flush() {
      if !text.isEmpty { segments.append(.text(text.joined(separator: "\n"))) }
      text = []
    }
    for line in paragraph.components(separatedBy: "\n") {
      if let media = parse(line: line) {
        flush()
        segments.append(.media(media))
      } else {
        text.append(line)
      }
    }
    flush()
    return segments
  }
}
