import Foundation

/// What a file viewer renders instead of (or next to) its source.
public enum FilePreviewKind: String, Sendable, CaseIterable {
  case markdown
  case pdf
  case image
  /// A web page, rendered sandboxed: no network unless the viewer allows it.
  case html
  /// Too large to open whole, so paged; never from an extension.
  case large

  public static func of(path: String) -> FilePreviewKind? {
    switch (path as NSString).pathExtension.lowercased() {
    case "md", "mdx", "markdown": .markdown
    case "pdf": .pdf
    case "html", "htm": .html
    case "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "heic", "tif", "tiff", "ico": .image
    default: nil
    }
  }

  /// Read as bytes rather than text: the host calls these binary.
  public var isBinary: Bool { self == .pdf || self == .image }

  /// Text shown rendered next to (or instead of) its source.
  public var isRenderedText: Bool { self == .markdown || self == .html }

  public static func isSVG(_ path: String) -> Bool {
    (path as NSString).pathExtension.lowercased() == "svg"
  }
}

/// Where a link or an image in a previewed Markdown file points.
public enum MarkdownTarget: Equatable, Sendable {
  /// A worktree-relative file, and the line a `#L12` fragment names.
  case file(path: String, line: Int?)
  /// `#heading` within the same document.
  case anchor(String)
  case external(URL)

  /// `href` as written in the document at `documentPath` (worktree-relative).
  /// Nil when it climbs out of the worktree or can't be parsed.
  public static func resolve(_ href: String, from documentPath: String) -> MarkdownTarget? {
    let href = href.trimmingCharacters(in: .whitespaces)
    guard !href.isEmpty else { return nil }
    if href.hasPrefix("#") { return .anchor(String(href.dropFirst())) }
    if let url = URL(string: href), let scheme = url.scheme?.lowercased(), !scheme.isEmpty {
      return ["http", "https", "mailto"].contains(scheme) ? .external(url) : nil
    }
    var path = href
    var line: Int?
    if let hash = path.firstIndex(of: "#") {
      let fragment = path[path.index(after: hash)...]
      if let match = fragment.wholeMatch(of: /L(\d+)(-L?\d+)?/) { line = Int(match.1) }
      path = String(path[..<hash])
    }
    if let query = path.firstIndex(of: "?") { path = String(path[..<query]) }
    path = path.removingPercentEncoding ?? path
    let joined: String
    if path.hasPrefix("/") {
      joined = path
    } else {
      let directory = (documentPath as NSString).deletingLastPathComponent
      joined = directory.isEmpty ? path : directory + "/" + path
    }
    guard let normalized = SessionFilePaths.normalized(joined), !normalized.isEmpty else { return nil }
    return .file(path: normalized, line: line)
  }

  /// GitHub's heading anchor: lower case, punctuation dropped, spaces to dashes.
  public static func anchor(for heading: String) -> String {
    let plain = heading.replacing(/[`*_~\[\]()]/, with: "")
    return String(
      plain.lowercased().unicodeScalars.compactMap { scalar -> Character? in
        if scalar == " " { return "-" }
        if scalar == "-" || CharacterSet.alphanumerics.contains(scalar) { return Character(scalar) }
        return nil
      })
  }
}
