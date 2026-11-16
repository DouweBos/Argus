import Foundation

/// An agent's `request_secret` call: what it needs, why, and where the value goes.
public struct SecretRequest: Sendable, Equatable {
  public enum Delivery: Sendable, Equatable {
    case file
    case env(runCommand: String, variable: String)
  }

  public let label: String
  public let reason: String
  public let delivery: Delivery

  public init(label: String, reason: String, delivery: Delivery) {
    self.label = label
    self.reason = reason
    self.delivery = delivery
  }

  /// `request_secret` under whatever prefix the runner gives MCP tools.
  public static func isTool(_ name: String) -> Bool {
    name == "request_secret" || name.hasSuffix("__request_secret")
  }

  public static func parse(name: String, input: [String: JSONValue]) -> SecretRequest? {
    guard isTool(name), let label = input["label"]?.stringValue else { return nil }
    let reason = input["reason"]?.stringValue ?? ""
    if input["delivery"]?.stringValue == "env",
      let run = input["run_command"]?.stringValue,
      let variable = input["env_var"]?.stringValue
    {
      return SecretRequest(label: label, reason: reason, delivery: .env(runCommand: run, variable: variable))
    }
    return SecretRequest(label: label, reason: reason, delivery: .file)
  }

  /// Where the value ends up, in words.
  public var destination: String {
    switch delivery {
    case .file:
      "Saved to a private file on your computer for the agent to read, deleted within 24 hours."
    case .env(let run, let variable):
      "Set as \(variable) for the “\(run)” run command, kept in memory only."
    }
  }
}
