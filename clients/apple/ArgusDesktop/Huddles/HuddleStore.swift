import ArgusCore
import Foundation
import Observation

/// Live huddle rooms, mirrored from `huddle:changed` — the host pushes the
/// whole list on every change, so this never polls. Rooms live in the host's
/// memory only: after a restart the list is empty, the intended fail-safe.
///
/// Also keeps each room pointed at the device its session has open, which
/// only this app knows (the desktop's `huddleDeviceMirror`).
@MainActor
@Observable
final class HuddleStore {
  private let store: HostStore
  private let runtime: RuntimeModel
  private(set) var rooms: [ArgusProtocol.HuddleRoomModel] = []
  /// Per room: the device key last pushed, so a re-render doesn't resend it.
  @ObservationIgnored private var pushedKeys: [String: String] = [:]
  @ObservationIgnored private var typingReporters: [String: HuddleTypingReporter] = [:]
  /// Chat messages read so far, per room, for the Chat button's count.
  var readCounts: [String: Int] = [:]
  /// The side chat is docked beside the agent.
  var chatOpen = false

  init(store: HostStore, runtime: RuntimeModel) {
    self.store = store
    self.runtime = runtime
    _ = store.observeIpc { [weak self] channel, args, _ in
      guard channel == "huddle:changed", let self else { return }
      let rooms = args.first?["rooms"].flatMap {
        try? ProtocolCodec.convert($0, to: [ArgusProtocol.HuddleRoomModel].self)
      }
      self.rooms = rooms ?? []
    }
    trackDevices()
  }

  private var backend: (any HostBackend)? { store.backend }
  var hostBackend: (any HostBackend)? { store.backend }
  var hostStore: HostStore { store }

  /// A room we just started, ahead of its `huddle:changed`.
  func adopt(_ room: ArgusProtocol.HuddleRoomModel) {
    if !rooms.contains(where: { $0.id == room.id }) { rooms.append(room) }
  }

  /// Hydrate on every (re)connect: a restarted host has no rooms.
  func load() async {
    guard let backend else { return }
    rooms = (try? await backend.request(ArgusProtocol.Commands.HuddleList.self, .init())) ?? []
  }

  func room(forAgent agentId: String?) -> ArgusProtocol.HuddleRoomModel? {
    guard let agentId else { return nil }
    return rooms.first { $0.agentId == agentId }
  }

  var pendingCount: Int { rooms.reduce(0) { $0 + Huddles.pending($1).count } }

  func unread(_ room: ArgusProtocol.HuddleRoomModel) -> Int {
    max(0, room.chat.count - (readCounts[room.id] ?? 0))
  }

  func markRead(_ room: ArgusProtocol.HuddleRoomModel) {
    readCounts[room.id] = room.chat.count
  }

  // MARK: Device

  func sessionId(ofAgent agentId: String) -> String? {
    store.live?.agents[agentId]?.sessionId ?? store.statusByAgent[agentId]?.sessionId
  }

  /// The key a share from this session would carry right now.
  func shareableDeviceKey(sessionId: String) -> String {
    Huddles.shareableDeviceKey(
      platform: runtime.platform.rawValue,
      iosUdid: runtime.selectedDevice(platform: .ios, session: sessionId),
      androidSerial: runtime.selectedDevice(platform: .android, session: sessionId),
      sessionId: sessionId)
  }

  /// The device's name, for "drive … with you".
  func deviceName(_ key: String) -> String? {
    guard !key.isEmpty else { return nil }
    if key.hasPrefix(Huddles.browserClaimPrefix) { return "the browser" }
    return runtime.simulator(key)?.name ?? runtime.androidDevice(key)?.name ?? "the device you have open"
  }

  private func wantedKeys() -> [String: String] {
    var wanted: [String: String] = [:]
    for room in rooms {
      guard let session = sessionId(ofAgent: room.agentId) else { continue }
      wanted[room.id] = shareableDeviceKey(sessionId: session)
    }
    return wanted
  }

  /// Re-armed on every change to the rooms or the runtime selection.
  private func trackDevices() {
    let wanted = withObservationTracking { wantedKeys() } onChange: {
      Task { @MainActor [weak self] in self?.trackDevices() }
    }
    syncDevices(wanted)
  }

  private func syncDevices(_ wanted: [String: String]) {
    pushedKeys = pushedKeys.filter { id, _ in rooms.contains { $0.id == id } }
    guard let backend else { return }
    for room in rooms {
      guard let key = wanted[room.id], key != room.deviceKey, pushedKeys[room.id] != key else { continue }
      pushedKeys[room.id] = key
      Task { [weak self] in
        do {
          _ = try await backend.request(
            ArgusProtocol.Commands.HuddleSetDevice.self, .init(roomId: room.id, deviceKey: key))
        } catch {
          self?.pushedKeys[room.id] = nil
        }
      }
    }
  }

  // MARK: Typing

  /// The host composing at a shared agent; a no-op when it isn't shared.
  func composerTyping(agentId: String, typing: Bool) {
    guard room(forAgent: agentId) != nil else {
      typingReporters[agentId]?.stop()
      return
    }
    let reporter =
      typingReporters[agentId]
      ?? HuddleTypingReporter { [weak self] typing in
        guard let self, let roomId = self.room(forAgent: agentId)?.id, let backend = self.backend else { return }
        Task {
          _ = try? await backend.request(
            ArgusProtocol.Commands.HuddleSetTyping.self, .init(roomId: roomId, typing: typing))
        }
      }
    typingReporters[agentId] = reporter
    if typing { reporter.keystroke() } else { reporter.stop() }
  }
}

#if DEBUG
  extension HuddleStore {
    func addRepoForTesting(_ path: String) async {
      _ = try? await hostBackend?.request(ArgusProtocol.Commands.AddRepoRoot.self, .init(path: path))
    }

    /// A room the dev driver can render without a tunnel: a guest waiting, one
    /// typing, and a little chat.
    func injectFixture(agentId: String, url: String?) {
      let now = Date().timeIntervalSince1970 * 1000
      let guests: [ArgusProtocol.HuddleGuestModel] = [
        .init(
          memberId: "m1", devStaticPub: "pub-ana", label: "Ana", state: .approved, joinedAt: now - 60_000,
          approvedAt: now - 50_000, connected: true, typing: true),
        .init(
          memberId: "m2", devStaticPub: "pub-ben", label: "Ben", state: .pending, joinedAt: now - 5_000,
          connected: true, typing: false),
      ]
      let chat: [ArgusProtocol.HuddleChatMessage] = [
        .init(id: "c1", author: "Ana", memberId: "m1", text: "Can you open the login screen?", at: now - 40_000),
        .init(id: "c2", author: "Host", memberId: nil, text: "On it.", at: now - 30_000),
      ]
      adopt(
        .init(
          id: "fixture-\(agentId)", token: "t", agentId: agentId, deviceKey: "", url: url,
          createdAt: now - 120_000, expiresAt: now + 3_600_000, guests: guests, hostTyping: false,
          hostLabel: "Host", chat: chat))
    }
  }
#endif
