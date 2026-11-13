import ArgusKit
import Foundation

/// Usage's "count only" and "leave out" model lists, as both apps edit them.
public enum UsageModelFilterList: CaseIterable, Sendable {
  case include, exclude

  public var title: String { self == .include ? "Count only these models" : "Leave out these models" }

  public var footer: String {
    switch self {
    case .include: "With any model here, Usage's cost and tokens count only these. Empty counts every model."
    case .exclude: "Usage's cost and tokens never count these models."
    }
  }
}

extension ArgusProtocol.UsageModelFilter {
  public static var empty: Self { .init(include: [], exclude: []) }

  /// The host clears an empty filter, so it goes over the wire as null.
  public var orNil: Self? { include.isEmpty && exclude.isEmpty ? nil : self }

  public subscript(list: UsageModelFilterList) -> [ArgusProtocol.UsageModelRule] {
    get { list == .include ? include : exclude }
    set { if list == .include { include = newValue } else { exclude = newValue } }
  }

  /// Nil when `rule` is already on that list.
  public func adding(_ rule: ArgusProtocol.UsageModelRule, to list: UsageModelFilterList) -> Self? {
    guard !self[list].contains(where: { $0.model == rule.model && $0.runner == rule.runner }) else { return nil }
    var next = self
    next[list].append(rule)
    return next
  }

  /// Replaces the rule at `index`, or removes it when `rule` is nil.
  public func changing(_ index: Int, in list: UsageModelFilterList, to rule: ArgusProtocol.UsageModelRule?) -> Self {
    var next = self
    guard next[list].indices.contains(index) else { return next }
    if let rule { next[list][index] = rule } else { next[list].remove(at: index) }
    return next
  }
}
