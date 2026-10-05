import Foundation

/// The app concerns a store reports to rather than owns: analytics, error
/// telemetry, local notifications and the phone's push bookkeeping. Every hook
/// defaults to doing nothing, so a test or a bare host needs none of them.
public struct HostStoreHooks: Sendable {
  /// A countable action happened.
  public var track: @MainActor @Sendable (StoreEvent) -> Void
  /// An error was surfaced to the user; `scope` names where it came from.
  public var errorReported: @MainActor @Sendable (_ error: Error, _ scope: String) -> Void
  /// The host asked for a notification to be shown.
  public var notify: @MainActor @Sendable (RemoteNotification) -> Void
  /// Agents seen on this host, so a push carrying only an agent id can be
  /// routed back to it.
  public var agentsSeen: @MainActor @Sendable ([String]) -> Void
  /// The host's reachable addresses changed.
  public var endpointsChanged: @MainActor @Sendable ([RemoteEndpoint]) -> Void
  /// A permission answer couldn't be delivered; the phone queues it for the
  /// next connection.
  public var decisionUndelivered:
    @MainActor @Sendable (_ agentId: String, _ toolUseId: String, _ decision: String) -> Void
  /// Whether the app's window has focus. A local host raises its own banner
  /// only when it doesn't — you're already looking at the agent otherwise.
  public var isAppFocused: @MainActor @Sendable () -> Bool
  /// A notification for this agent was clicked; navigate to it.
  public var agentNotificationClicked:
    @MainActor @Sendable (_ agentId: String, _ sessionId: String) -> Void
  /// Whether a session runs on another machine, so a file dropped here has
  /// to be uploaded before its agent can open it.
  public var sessionIsRemote: @MainActor @Sendable (_ sessionId: String) -> Bool = { _ in false }

  public init(
    track: @escaping @MainActor @Sendable (StoreEvent) -> Void = { _ in },
    errorReported: @escaping @MainActor @Sendable (Error, String) -> Void = { _, _ in },
    notify: @escaping @MainActor @Sendable (RemoteNotification) -> Void = { _ in },
    agentsSeen: @escaping @MainActor @Sendable ([String]) -> Void = { _ in },
    endpointsChanged: @escaping @MainActor @Sendable ([RemoteEndpoint]) -> Void = { _ in },
    decisionUndelivered:
      @escaping @MainActor @Sendable (String, String, String) -> Void = { _, _, _ in },
    isAppFocused: @escaping @MainActor @Sendable () -> Bool = { true },
    agentNotificationClicked: @escaping @MainActor @Sendable (String, String) -> Void = { _, _ in }
  ) {
    self.track = track
    self.errorReported = errorReported
    self.notify = notify
    self.agentsSeen = agentsSeen
    self.endpointsChanged = endpointsChanged
    self.decisionUndelivered = decisionUndelivered
    self.isAppFocused = isAppFocused
    self.agentNotificationClicked = agentNotificationClicked
  }
}
