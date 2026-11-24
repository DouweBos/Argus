import ArgusKit

extension ArgusProtocol.TeammateThreadSurface {
  /// Where a conversation came from; nil for one started in Argus.
  public var label: String? {
    switch self {
    case .slack: "Slack"
    case .linear: "Linear"
    case .handoff: "From a teammate"
    default: nil
    }
  }

  public var icon: String? {
    switch self {
    case .slack: "number"
    case .linear: Icon.issue
    case .handoff: "person.2"
    default: nil
    }
  }
}
