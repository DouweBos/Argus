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

extension AttributedString {
  /// Bare URLs, and file paths when `files`, become links, except where markdown
  /// already made one. `mentions` is for what a person typed: only `@paths` count
  /// as files there, as on the Mac.
  public func linkified(files: Bool, mentions: Bool = false) -> AttributedString {
    let plain = String(characters)
    let matches = mentions ? FileLinks.mentionMatches(in: plain) : FileLinks.matches(in: plain)
    guard !matches.isEmpty else { return self }
    var out = self
    for match in matches {
      if case .file = match.kind, !files { continue }
      guard let url = FileLinks.url(for: match.kind), let range = Range(match.range, in: plain)
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
    content
      .environment(\.openURL, OpenURLAction { url in
        open(url)
        return .handled
      })
      #if DEBUG
        .onAppear { DevLinkTap.open = open }
      #endif
  }

  private func open(_ url: URL) {
    if let openFileLink, let ref = FileLinks.fileRef(from: url) {
      openFileLink(ref)
    } else {
      openURL(url)
    }
  }
}

#if DEBUG
  /// Where a link tap in rendered text lands, for the dev driver: a gesture on
  /// text is out of reach of the accessibility API that drives everything else.
  @MainActor
  public enum DevLinkTap {
    static var open: ((URL) -> Void)?

    /// Opens what a link reading `label` points at, as tapping it would. False when nothing is on screen to take it.
    public static func tap(label: String) -> Bool {
      let linked = AttributedString(label).linkified(files: true, mentions: label.hasPrefix("@"))
      guard let open, let url = linked.runs.lazy.compactMap(\.link).first ?? URL(string: label) else { return false }
      open(url)
      return true
    }
  }
#endif
