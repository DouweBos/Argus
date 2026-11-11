import Foundation

extension RemoteMessageCommand {
  /// What the chip reads: `/implement-ticket`.
  public var label: String { "/\(name)" }

  /// A playbook to reveal: only an Argus command sent something other than what was typed.
  public var playbook: String? {
    guard kind == .argus, let prompt, !prompt.isEmpty else { return nil }
    return prompt
  }

  /// The Linear issue the argument names, as an identifier or an issue URL.
  public var issueIdentifier: String? {
    guard let argument else { return nil }
    if argument.wholeMatch(of: /[A-Z][A-Z0-9]*-\d+/) != nil { return argument }
    guard let url = URL(string: argument), url.host()?.hasSuffix("linear.app") == true,
      let issue = url.pathComponents.firstIndex(of: "issue"), issue + 1 < url.pathComponents.count
    else { return nil }
    let id = url.pathComponents[issue + 1]
    return id.wholeMatch(of: /[A-Za-z][A-Za-z0-9]*-\d+/) != nil ? id.uppercased() : nil
  }

  /// How the chip shows the argument: an issue by its identifier, anything else as typed.
  public var argumentLabel: String? { issueIdentifier ?? argument }

  /// Where an argument that isn't a Linear issue links to, when it's a web address.
  public var argumentURL: URL? {
    guard issueIdentifier == nil, let argument, let url = URL(string: argument),
      url.scheme == "https" || url.scheme == "http"
    else { return nil }
    return url
  }

  /// The telemetry value for the command: Argus's own by name, a runner's never.
  public var telemetryName: String { kind == .argus ? name : "runner" }
}

extension RemoteMessage {
  /// The text under a command's chip — its notes — or the message's own text otherwise.
  public var bodyBlocks: [String] {
    guard let command else { return displayBlocks }
    return command.notes.map { [$0] } ?? []
  }
}
