import ActivityKit
import ArgusCore
import SwiftUI

/// Runs the agents' Live Activity: one per computer, started here while the
/// app is open and agents are working, then kept current by that computer's
/// pushes alone. This side only starts it, hands its push token over, and
/// answers the Approve/Deny buttons on it.
@MainActor
final class AgentActivities {
  static let shared = AgentActivities()

  private var watching: [String: Task<Void, Never>] = [:]
  private var tokens: [String: String] = [:]
  /// Tokens the relay already knows, so a reconnect doesn't re-register them.
  private var relayKnows: Set<String> = []
  private var starting = false

  private var running: [ActivityKit.Activity<AgentActivityAttributes>] {
    ActivityKit.Activity<AgentActivityAttributes>.activities.filter {
      $0.activityState == .active || $0.activityState == .stale
    }
  }

  /// The intent's hook, set at launch: Lock Screen answers come through here.
  func install() {
    AgentActivityActions.answer = { answer in await AgentActivities.shared.answer(answer) }
  }

  /// Start, adopt or hand over the activity for the connected computer.
  /// `connected` re-registers, since a restarted computer forgets the token.
  func sync(_ app: AppStore, connected: Bool = false) async {
    let paired = Set(app.hosts.map(\.deviceId))
    await Self.end { !paired.contains($0.hostId) }
    guard app.liveActivitiesEnabled, ActivityAuthorizationInfo().areActivitiesEnabled,
      let hostId = app.activeHostId, app.identity?.deviceId == hostId,
      app.host.connection == .ready
    else { return }

    if let activity = running.first(where: { $0.attributes.hostId == hostId }) {
      watch(activity, app)
      if connected, let token = tokens[activity.id] { await register(token, for: activity, app) }
      return
    }
    let busy = app.host.recentAgents.contains { $0.status == .running || $0.status == .requiresAction }
    guard busy, !starting, UIApplication.shared.applicationState == .active else { return }
    starting = true
    defer { starting = false }
    await start(app, hostId: hostId)
  }

  func setEnabled(_ enabled: Bool, app: AppStore) async {
    guard !enabled else {
      await sync(app, connected: true)
      return
    }
    await Self.end { _ in true }
    if let backend = app.host.liveBackend {
      _ = try? await backend.request(.liveActivityUnregister, EmptyParams(), as: IgnoredResult.self)
    }
  }

  private func start(_ app: AppStore, hostId: String) async {
    struct SnapshotResult: Decodable { let snapshot: AgentActivitySnapshot }
    guard let backend = app.host.liveBackend,
      let result = try? await backend.request(.liveActivitySnapshot, EmptyParams(), as: SnapshotResult.self),
      !result.snapshot.isSettled
    else { return }
    let attributes = AgentActivityAttributes(
      hostId: hostId, hostName: app.identity?.label ?? "Your computer", canRespond: app.host.hasControl)
    do {
      let activity = try ActivityKit.Activity.request(
        attributes: attributes,
        content: .init(state: AgentActivityState(snapshot: result.snapshot), staleDate: .now.addingTimeInterval(3600)),
        pushType: .token)
      Telemetry.capture(.liveActivity(action: .started))
      watch(activity, app)
    } catch {
      Telemetry.captureException(error, source: "app_error", extra: ["scope": "live_activity"])
    }
  }

  /// Follows the activity's push token, which Apple may rotate, until it ends.
  private func watch(_ activity: ActivityKit.Activity<AgentActivityAttributes>, _ app: AppStore) {
    guard watching[activity.id] == nil else { return }
    let id = activity.id
    watching[id] = Task { [weak self] in
      for await data in activity.pushTokenUpdates {
        let token = data.map { String(format: "%02x", $0) }.joined()
        self?.tokens[id] = token
        await self?.register(token, for: activity, app)
      }
      self?.watching[id] = nil
      self?.tokens[id] = nil
    }
  }

  /// The relay first, so it can verify the computer's first push.
  private func register(_ token: String, for activity: ActivityKit.Activity<AgentActivityAttributes>, _ app: AppStore) async {
    guard app.activeHostId == activity.attributes.hostId, let backend = app.host.liveBackend else { return }
    struct PushInfo: Decodable { let relay_url: String? }
    let keys = PushTokens.relayKeys()
    if !relayKnows.contains(token),
      let info = try? await backend.request(.devicePushInfo, EmptyParams(), as: PushInfo.self),
      let relayURL = info.relay_url
    {
      guard await PushTokens.registerWithRelay(relayURL: relayURL, token: token, authKey: keys.authKey) == .ok
      else { return }
      relayKnows.insert(token)
    }
    let params = ArgusProtocol.MethodsTypes.LiveActivityRegisterParams(
      token: token, environment: .init(rawValue: PushTokens.environment),
      pushKey: keys.pushKey, authKey: keys.authKey)
    _ = try? await backend.request(.liveActivityRegister, params, as: IgnoredResult.self)
  }

  /// Approve/Deny from the Lock Screen or the Dynamic Island.
  private func answer(_ answer: AgentActivityActions.Answer) async {
    Telemetry.capture(.liveActivity(action: .answered))
    await Self.clearPrompt(answer)
    let decision = answer.allow ? "allow" : "deny"
    do {
      let app = try await IntentHost.connect(answer.hostId, control: true)
      await app.host.respond(agentId: answer.agentId, toolUseId: answer.toolUseId, decision: decision)
    } catch {
      // Unreachable for now: the answer waits for that computer, like a notification's.
      AppRuntime.app.pendingDecisions.queue(
        PendingDecision(
          agentId: answer.agentId, hostId: answer.hostId, toolUseId: answer.toolUseId,
          decision: decision, at: Date().timeIntervalSince1970 * 1000))
    }
  }

  /// Drop the buttons at once; the computer's next push confirms it.
  /// Off the main actor: an `Activity` isn't `Sendable`, so it is looked up where it is used.
  nonisolated private static func clearPrompt(_ answer: AgentActivityActions.Answer) async {
    for activity in ActivityKit.Activity<AgentActivityAttributes>.activities
    where activity.attributes.hostId == answer.hostId {
      guard var snapshot = activity.content.state.snapshot,
        let index = snapshot.agents.firstIndex(where: { $0.id == answer.agentId })
      else { continue }
      snapshot.agents[index].prompt = nil
      snapshot.agents[index].state = .working
      await activity.update(
        .init(state: AgentActivityState(snapshot: snapshot), staleDate: activity.content.staleDate))
    }
  }

  nonisolated private static func end(where shouldEnd: @Sendable (AgentActivityAttributes) -> Bool) async {
    for activity in ActivityKit.Activity<AgentActivityAttributes>.activities where shouldEnd(activity.attributes) {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }
}

/// Starts the activity once agents are working while the app is open.
struct LiveActivitySync: ViewModifier {
  let app: AppStore
  @Environment(\.scenePhase) private var scenePhase

  private var busy: Set<String> {
    Set(app.host.recentAgents.filter { $0.status == .running || $0.status == .requiresAction }.map(\.agentId))
  }

  func body(content: Content) -> some View {
    content
      .onChange(of: busy) { _, busy in
        guard !busy.isEmpty else { return }
        Task { await AgentActivities.shared.sync(app) }
      }
      .onChange(of: scenePhase) { _, phase in
        guard phase == .active else { return }
        Task { await AgentActivities.shared.sync(app) }
      }
  }
}
