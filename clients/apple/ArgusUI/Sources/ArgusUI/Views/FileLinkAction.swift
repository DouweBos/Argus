import ArgusCore
import SwiftUI

/// Opens a file reference tapped in rendered text. Unset (the default), file paths
/// stay plain text — a screen opts in when it has somewhere to open them.
public struct OpenFileLinkAction {
  let handler: @MainActor (FileLinks.FileRef) -> Void

  public init(_ handler: @escaping @MainActor (FileLinks.FileRef) -> Void) {
    self.handler = handler
  }

  @MainActor public func callAsFunction(_ ref: FileLinks.FileRef) { handler(ref) }
}

extension EnvironmentValues {
  @Entry public var openFileLink: OpenFileLinkAction?
}

/// File links travel through `Text` as URLs on a private scheme, so SwiftUI hit-tests them.
public enum FileLinkURL {
  public static let scheme = "argus-file"

  public static func url(for ref: FileLinks.FileRef) -> URL? {
    var components = URLComponents()
    components.scheme = scheme
    components.host = "open"
    components.queryItems =
      [URLQueryItem(name: "path", value: ref.path)]
      + (ref.line.map { [URLQueryItem(name: "line", value: String($0))] } ?? [])
    return components.url
  }

  public static func fileRef(from url: URL) -> FileLinks.FileRef? {
    guard url.scheme == scheme,
      let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
      let path = items.first(where: { $0.name == "path" })?.value
    else { return nil }
    let line = items.first { $0.name == "line" }?.value.flatMap(Int.init)
    return FileLinks.FileRef(path: path, line: line)
  }
}

extension AttributedString {
  /// File paths become `argus-file:` links, except where markdown already made a link.
  public func linkingFilePaths() -> AttributedString {
    let plain = String(characters)
    let matches = FileLinks.matches(in: plain)
    guard !matches.isEmpty else { return self }
    var out = self
    for match in matches {
      guard case .file(let ref) = match.kind, let url = FileLinkURL.url(for: ref),
        let range = Range(match.range, in: plain)
      else { continue }
      let start = plain.unicodeScalars.distance(from: plain.startIndex, to: range.lowerBound)
      let length = plain.unicodeScalars.distance(from: range.lowerBound, to: range.upperBound)
      let lower = out.unicodeScalars.index(out.startIndex, offsetBy: start)
      let upper = out.unicodeScalars.index(lower, offsetBy: length)
      guard !out[lower..<upper].runs.contains(where: { $0.link != nil }) else { continue }
      out[lower..<upper].link = url
    }
    return out
  }
}

/// Routes `argus-file:` taps to `openFileLink`; every other URL goes where it would have.
struct FileLinkHandling: ViewModifier {
  @Environment(\.openFileLink) private var openFileLink
  @Environment(\.openURL) private var openURL

  func body(content: Content) -> some View {
    if let openFileLink {
      content.environment(
        \.openURL,
        OpenURLAction { url in
          if let ref = FileLinkURL.fileRef(from: url) {
            openFileLink(ref)
          } else {
            openURL(url)
          }
          return .handled
        })
    } else {
      content
    }
  }
}
