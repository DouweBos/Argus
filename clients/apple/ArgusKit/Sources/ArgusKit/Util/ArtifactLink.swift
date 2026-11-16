import Foundation

/// A claude.ai Artifact an agent published or opened with Claude Code's
/// Artifact tool: the page to show and what to call it.
public struct ArtifactLink: Hashable, Sendable, Codable {
  public enum Action: String, Sendable, Codable {
    case publish, open
  }

  public var url: URL
  public var title: String
  public var action: Action

  public init(url: URL, title: String, action: Action) {
    self.url = url
    self.title = title
    self.action = action
  }

  public static let toolName = "Artifact"

  /// The call shows a page: a publish (not an asset upload) or an open.
  public static func action(of call: RemoteToolCall) -> Action? {
    guard call.name == toolName else { return nil }
    switch call.input["action"]?.stringValue {
    case nil, "publish": return call.input["asset"]?.boolValue == true ? nil : .publish
    case "open": return .open
    default: return nil
    }
  }

  /// The page a finished publish or open landed on; nil until it has, or when it failed.
  public static func from(_ call: RemoteToolCall) -> ArtifactLink? {
    guard let action = action(of: call), call.status == .done, call.isError != true else { return nil }
    let text = call.resultBlocks.compactMap { block -> String? in
      if case .text(let text) = block { return text }
      return nil
    }.joined(separator: "\n")
    guard let url = firstArtifactURL(in: text) ?? call.input["url"]?.stringValue.flatMap(artifactURL) else {
      return nil
    }
    return ArtifactLink(url: url, title: title(of: call), action: action)
  }

  /// The CLI names a page after its file when nothing else does; an open has only its link.
  public static func title(of call: RemoteToolCall) -> String {
    if let path = call.input["file_path"]?.stringValue, !path.isEmpty {
      let name = (path as NSString).lastPathComponent
      let stem = (name as NSString).deletingPathExtension
      return stem.isEmpty ? name : stem
    }
    return "Artifact"
  }

  /// `…/artifact/{id}` or `…/code/artifact/{uuid}` on claude.ai (or a staging host).
  static func artifactURL(_ raw: String) -> URL? {
    guard let url = URL(string: raw), url.scheme == "https", url.host() != nil else { return nil }
    let parts = url.pathComponents
    guard let at = parts.lastIndex(of: "artifact"), at + 1 < parts.count, !parts[at + 1].isEmpty else {
      return nil
    }
    return url
  }

  static func firstArtifactURL(in text: String) -> URL? {
    guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else {
      return nil
    }
    let range = NSRange(text.startIndex..., in: text)
    for match in detector.matches(in: text, range: range) {
      if let raw = match.url?.absoluteString, let url = artifactURL(raw) { return url }
    }
    return nil
  }
}
