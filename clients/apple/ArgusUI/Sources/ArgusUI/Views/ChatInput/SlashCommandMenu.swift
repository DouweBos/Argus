import ArgusKit
import Foundation

/// The desktop's slash-command menu: the agent's commands plus the built-ins
/// the CLI hides in headless mode. Mirrors `AgentChat.tsx` / `ChatInput.tsx`.
public enum SlashCommandMenu {
  public static let maxResults = 8

  public struct Command: Equatable, Sendable, Identifiable {
    public var name: String
    public var description: String
    public var argumentHint: String

    public var id: String { name }

    public init(name: String, description: String, argumentHint: String) {
      self.name = name
      self.description = description
      self.argumentHint = argumentHint
    }

    public init(_ command: RemoteSlashCommand) {
      self.init(
        name: command.name, description: command.description,
        argumentHint: command.argumentHint)
    }
  }

  public static let builtins: [Command] = [
    .init(name: "clear", description: "Clear conversation history", argumentHint: ""),
    .init(
      name: "plan", description: "Enable plan mode or view the session plan",
      argumentHint: "[open|<description>]"),
    .init(name: "model", description: "Switch the model for this session", argumentHint: "[model]"),
    .init(
      name: "compact", description: "Summarize and clear conversation context",
      argumentHint: "[instructions]"),
    .init(name: "help", description: "Show help and available commands", argumentHint: ""),
    .init(name: "doctor", description: "Diagnose your Claude Code installation", argumentHint: ""),
    .init(name: "status", description: "Show model, account, and tool status", argumentHint: ""),
    .init(name: "fast", description: "Toggle fast mode", argumentHint: ""),
    .init(
      name: "effort", description: "Set reasoning effort level",
      argumentHint: "[low|medium|high|xhigh|max|ultracode]"),
  ]

  /// Never reaches the agent: opens the composer's limits panel.
  public static let usageLimits = Command(
    name: "usage-limits", description: "Show what's left of this agent's plan limits", argumentHint: "")

  /// Built-ins merged with the agent's own; the agent's entry wins when it
  /// describes itself. Alphabetical — the desktop's per-project usage ranking
  /// has no store behind it here. `local` are the client's own, offered as they apply.
  public static func merged(_ commands: [Command], local: [Command] = []) -> [Command] {
    var byName: [String: Command] = [:]
    for command in builtins + local { byName[command.name] = command }
    for command in commands where byName[command.name] == nil || !command.description.isEmpty {
      byName[command.name] = command
    }
    return byName.values.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
  }

  /// Open only while the first token is still being typed.
  public static func suggestions(
    for text: String, in commands: [Command]
  ) -> [Command] {
    guard text.hasPrefix("/"), !text.contains(" "), !text.contains("\n") else { return [] }
    let needle = text.dropFirst().lowercased()
    return Array(
      commands.filter { needle.isEmpty || $0.name.lowercased().contains(needle) }
        .prefix(maxResults))
  }

  public static func accepted(_ command: Command) -> String { "/\(command.name) " }

  /// Ghost text after `/name ` until an argument is typed.
  public static func argumentHint(for text: String, in commands: [Command]) -> String? {
    guard text.hasPrefix("/"), let last = text.last, last == " " || last == "\t" else { return nil }
    let name = text.dropFirst().dropLast()
    guard !name.isEmpty, !name.contains(where: \.isWhitespace) else { return nil }
    let hint = commands.first { $0.name.lowercased() == name.lowercased() }?.argumentHint
    return hint?.isEmpty == false ? hint : nil
  }

  /// Commands the desktop handles itself rather than sending to the CLI.
  public enum Local: Equatable, Sendable {
    case togglePlan
    case setModel(String)
    case openModelPicker
    case showUsageLimits
  }

  public static func local(_ message: String) -> Local? {
    let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmed.hasPrefix("/") else { return nil }
    let parts = trimmed.dropFirst().split(whereSeparator: \.isWhitespace)
    guard let command = parts.first?.lowercased() else { return nil }
    switch command {
    case "plan": return .togglePlan
    case usageLimits.name: return parts.count == 1 ? .showUsageLimits : nil
    case "model":
      let argument = parts.dropFirst().joined(separator: " ")
      return argument.isEmpty ? .openModelPicker : .setModel(argument)
    default: return nil
    }
  }
}
