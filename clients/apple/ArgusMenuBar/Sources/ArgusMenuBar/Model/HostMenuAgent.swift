import ArgusCore

/// What the agent lines read: the server's wire type and the Mac app's store type both fit.
public protocol HostMenuAgent {
  var agentId: String { get }
  var sessionId: String { get }
  var sessionLabel: String? { get }
  var projectName: String? { get }
  var title: String? { get }
  var createdAt: Double? { get }
  var isWorking: Bool { get }
  /// Blocked on a permission, a question or a plan.
  var needsYou: Bool { get }
}

extension ArgusProtocol.RemoteAgentStatus: HostMenuAgent {
  public var isWorking: Bool { status == .running }
  public var needsYou: Bool { status == .requiresAction }
}

extension RemoteAgentStatus: HostMenuAgent {
  public var isWorking: Bool { status == .running }
  public var needsYou: Bool { status == .requiresAction }
}
