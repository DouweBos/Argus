import ArgusCore
import Foundation

/// What the huddle sheet, chat and join requests do. The room list itself
/// updates from `huddle:changed`, so these only report failure.
extension HuddleStore {
  private var host: (any HostBackend)? { hostBackend }

  /// Ask before the user commits: a missing `cloudflared` is a two-minute
  /// install, and finding that out after a spinner helps nobody.
  func readiness() async -> ArgusProtocol.ShareErrorPayload? {
    guard let host else { return nil }
    return try? await host.request(ArgusProtocol.Commands.HuddleShareReadiness.self, .init()).blocker
  }

  /// Nil once the room is up; else what stopped it, as guidance.
  func start(agentId: String, deviceKey: String, hostLabel: String) async -> ArgusProtocol.ShareErrorPayload? {
    guard let host else { return nil }
    do {
      let room = try await host.request(
        ArgusProtocol.Commands.HuddleStart.self,
        .init(agentId: agentId, deviceKey: deviceKey.isEmpty ? nil : deviceKey, hostLabel: hostLabel))
      adopt(room)
      MacTelemetry.capture(.huddleUsed(action: .start, hasDevice: !deviceKey.isEmpty))
      return nil
    } catch {
      MacTelemetry.capture(.huddleUsed(action: .blocked, hasDevice: !deviceKey.isEmpty))
      return Self.shareError(error)
    }
  }

  func stop(_ room: ArgusProtocol.HuddleRoomModel) {
    act(.stop, room) { try await $0.request(ArgusProtocol.Commands.HuddleStop.self, .init(roomId: room.id)) }
  }

  func approve(_ room: ArgusProtocol.HuddleRoomModel, _ guest: String) {
    act(.approve, room) {
      try await $0.request(ArgusProtocol.Commands.HuddleApproveGuest.self, .init(roomId: room.id, devStaticPub: guest))
    }
  }

  func deny(_ room: ArgusProtocol.HuddleRoomModel, _ guest: String) {
    act(.deny, room) {
      try await $0.request(ArgusProtocol.Commands.HuddleDenyGuest.self, .init(roomId: room.id, devStaticPub: guest))
    }
  }

  func remove(_ room: ArgusProtocol.HuddleRoomModel, _ guest: String) {
    act(.remove, room) {
      try await $0.request(ArgusProtocol.Commands.HuddleRemoveGuest.self, .init(roomId: room.id, devStaticPub: guest))
    }
  }

  func say(_ room: ArgusProtocol.HuddleRoomModel, _ text: String) {
    act(.say, room) {
      try await $0.request(ArgusProtocol.Commands.HuddleSay.self, .init(roomId: room.id, text: text))
    }
  }

  private func act(
    _ action: MacTelemetryEvent.HuddleAction, _ room: ArgusProtocol.HuddleRoomModel,
    _ run: @escaping (any HostBackend) async throws -> Bool
  ) {
    guard let host else { return }
    MacTelemetry.capture(.huddleUsed(action: action, hasDevice: !room.deviceKey.isEmpty))
    let store = hostStore
    Task {
      do { _ = try await run(host) } catch { store.report(error, scope: "huddle") }
    }
  }

  /// The session's git `user.name`, for an invite with no name configured.
  func gitName(sessionId: String) async -> String? {
    guard let host else { return nil }
    let author = try? await host.request(ArgusProtocol.Commands.GetGitAuthor.self, .init(id: sessionId))
    return author?.first?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
  }

  /// A share failure carries the `__shareError` envelope in the wire error's
  /// data; anything else is dressed as guidance so the sheet stays one shape.
  static func shareError(_ error: Error) -> ArgusProtocol.ShareErrorPayload {
    if case .gateway(let payload)? = error as? Transport.TransportError, let data = payload.data,
      let share = try? ProtocolCodec.convert(data, to: ArgusProtocol.ShareErrorPayload.self)
    {
      return share
    }
    return .init(
      shareError: true, kind: .init(rawValue: "unknown"), message: "Couldn't start sharing",
      explanation:
        "Argus couldn't get a link for this agent. The details below are what the sharing layer reported.",
      steps: ["Try again.", "If it keeps happening, check Settings → Remote."],
      detail: HostStore.describe(error))
  }
}
