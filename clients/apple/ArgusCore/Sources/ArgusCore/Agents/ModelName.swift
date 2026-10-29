import ArgusKit
import Foundation

/// How a model reads in a pill: "Claude Opus 5.5", not `claude-opus-5-5[1m]` or "Default (recommended)".
public enum ModelName {
  /// `claude-opus-5-5[1m]` → "Claude Opus 5.5"; nil for an id that isn't `claude-<family>-<version>`.
  public static func pretty(_ id: String) -> String? {
    let base = id.split(separator: "[", maxSplits: 1).first.map(String.init) ?? id
    let parts = base.lowercased().split(separator: "-").map(String.init)
    guard parts.count >= 3, parts[0] == "claude", parts[1].allSatisfy(\.isLetter) else { return nil }
    // A trailing snapshot date (`-20250805`) is no part of the name.
    let version = parts.dropFirst(2).filter { $0.count < 8 }
    guard !version.isEmpty, version.allSatisfy({ $0.allSatisfy(\.isNumber) }) else { return nil }
    return "Claude \(parts[1].capitalized) \(version.joined(separator: "."))"
  }

  /// An alias by the model it runs, else the CLI's own name for it.
  public static func label(_ model: RemoteModelInfo) -> String {
    model.resolvedModel.flatMap(pretty) ?? pretty(model.value) ?? model.displayName
  }

  /// What an agent on `value` runs; nil `value` is the CLI default.
  public static func label(for value: String?, in models: [RemoteModelInfo]) -> String? {
    let picked = value ?? "default"
    if let known = models.first(where: { $0.value == picked }) { return label(known) }
    guard let value else { return models.first.map(label) }
    return pretty(value) ?? value
  }
}
