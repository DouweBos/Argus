import ArgusKit
import Foundation

/// A teammate's profile while it is being edited: identity, soul and the
/// defaults its duties inherit. Saving is explicit, so this holds the edits.
public struct TeammateDraft: Equatable, Sendable {
  public var name: String
  public var handle: String
  public var tagline: String
  public var color: ArgusProtocol.TeammateColor
  /// Nil shows its initials.
  public var symbol: ArgusProtocol.TeammateSymbol?
  public var soul: String
  /// Nil inherits the computer's default rung.
  public var autonomy: RemoteAutonomy?
  public var repoRoots: [String]
  public var sourceIds: [String]
  public var guardrails: RemoteAutomationGuardrails

  public init(_ teammate: ArgusProtocol.Teammate, soul: String) {
    name = teammate.name
    handle = teammate.handle
    tagline = teammate.tagline
    color = teammate.color
    if case .symbol(let avatar) = teammate.avatar { symbol = avatar.symbol }
    self.soul = soul
    autonomy = teammate.autonomy.flatMap { RemoteAutonomy(rawValue: $0.rawValue) }
    repoRoots = teammate.scope.repoRoots
    sourceIds = teammate.sourceIds
    guardrails = WireRecode.convert(teammate.guardrails) ?? RemoteAutomationGuardrails()
  }

  public static let colors: [ArgusProtocol.TeammateColor] = [
    .blue, .purple, .pink, .red, .orange, .yellow, .green, .teal,
  ]
  public static let symbols: [ArgusProtocol.TeammateSymbol] = [
    .wrench, .eye, .tray, .shippingbox, .doc, .ant, .calendar, .leaf, .sparkles, .bolt, .magnifyingglass,
    .person,
  ]

  public var avatar: ArgusProtocol.TeammateAvatar {
    symbol.map { .symbol(.init(kind: "symbol", symbol: $0)) } ?? .initials(.init(kind: "initials"))
  }

  /// Why the handle can't be saved, matching the host's rule.
  public var handleError: String? {
    if handle.range(of: #"^[a-z0-9][a-z0-9-]{0,31}$"#, options: .regularExpression) != nil { return nil }
    return "Lowercase letters, digits and dashes, up to 32."
  }

  public var canSave: Bool {
    !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && handleError == nil
  }

  /// Everything but the soul, which saves on its own.
  public var patch: ArgusProtocol.UpdateTeammateInput {
    ArgusProtocol.UpdateTeammateInput(
      name: name.trimmingCharacters(in: .whitespacesAndNewlines),
      handle: handle,
      tagline: tagline.trimmingCharacters(in: .whitespacesAndNewlines),
      color: color,
      avatar: avatar,
      scope: .init(repoRoots: repoRoots),
      sourceIds: sourceIds,
      autonomy: autonomy.map { ArgusProtocol.AutonomyLevel(rawValue: $0.rawValue) },
      guardrails: WireRecode.convert(guardrails))
  }
}

/// Moves a value between a generated wire type and the hand-written one with
/// the same wire shape.
public enum WireRecode {
  public static func convert<Output: Decodable>(_ value: some Encodable) -> Output? {
    guard let data = try? JSONEncoder().encode(value) else { return nil }
    return try? JSONDecoder().decode(Output.self, from: data)
  }
}

extension RemoteAutomation {
  /// A teammate's duty, as the automation screens read one.
  public init?(wire: ArgusProtocol.RemoteAutomation) {
    guard let automation: RemoteAutomation = WireRecode.convert(wire) else { return nil }
    self = automation
  }
}
