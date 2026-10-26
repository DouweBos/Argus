import Foundation

/// Context-window sizing for the fill meter, ported from `contextWindow.ts`.
public enum ContextWindow {
  public static let defaultLimit = 200_000
  public static let oneMillion = 1_000_000

  /// A 1M-context variant announces itself in the model id or its copy; there
  /// is no structured flag for it on the wire.
  public static func limit(forModel model: String?, capabilities: RemoteAgentCapabilities?)
    -> Int
  {
    let info = capabilities?.models.first { $0.value == model }
      ?? capabilities?.models.first { $0.value == "default" }
    let haystack = [model, info?.value, info?.displayName, info?.description]
      .compactMap { $0 }
      .joined(separator: " ")
    let pattern = #"\[1m\]|\b1\s*m(illion)?\s*context\b"#
    if haystack.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil {
      return oneMillion
    }
    return claudeIdLimit(model) ?? defaultLimit
  }

  /// The Claude 5 family runs a 1M window; nil for ids that aren't Claude's.
  static func claudeIdLimit(_ id: String?) -> Int? {
    guard let id,
      let match = id.range(of: #"^claude-([a-z]+-)?\d+"#, options: [.regularExpression, .caseInsensitive]),
      let major = Int(id[match].split(separator: "-").last ?? "")
    else { return nil }
    return major >= 5 ? oneMillion : defaultLimit
  }

  /// All four counts occupy the window, cache reads included.
  public static func tokensInContext(_ usage: RemoteTokenUsage?) -> Int {
    guard let usage else { return 0 }
    return usage.inputTokens + usage.outputTokens
      + (usage.cacheReadInputTokens ?? 0) + (usage.cacheCreationInputTokens ?? 0)
  }

  public static func format(_ count: Int) -> String {
    if count >= 1_000_000 {
      return String(format: "%.1fM", Double(count) / 1_000_000)
    }
    if count >= 1_000 {
      return "\(count / 1000)k"
    }
    return "\(count)"
  }
}
