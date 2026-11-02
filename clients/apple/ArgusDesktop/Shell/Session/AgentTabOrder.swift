import Foundation
import Observation

/// Each session's agent tabs as the user dragged them, kept in the home and
/// handed to the host like the side panels. Sessions never dragged keep creation order.
@MainActor
@Observable
final class AgentTabOrder {
  static let key = "agents.tabOrder"

  private let defaults: HomeDefaults
  private(set) var orders: [String: [String]]

  init(defaults: HomeDefaults = .shared) {
    self.defaults = defaults
    orders = Self.load(defaults)
  }

  func order(_ session: String) -> [String]? { orders[session] }

  func set(_ ids: [String], session: String) {
    guard orders[session] != ids else { return }
    orders[session] = ids
    guard let data = try? JSONEncoder().encode(orders), let text = String(data: data, encoding: .utf8) else { return }
    defaults.set(text, forKey: Self.key)
  }

  /// Picks up what the host handed over on connect.
  func reloadPersisted() {
    let loaded = Self.load(defaults)
    if loaded != orders { orders = loaded }
  }

  private static func load(_ defaults: HomeDefaults) -> [String: [String]] {
    guard let data = defaults.string(forKey: key)?.data(using: .utf8) else { return [:] }
    return (try? JSONDecoder().decode([String: [String]].self, from: data)) ?? [:]
  }
}
