import Foundation

/// Pure huddle logic, the same rules as the desktop's `huddleStore` and
/// `huddleInvite`/`huddleDevice` helpers.
public enum Huddles {
  /// Guests still waiting on the host, in join order.
  public static func pending(_ room: ArgusProtocol.HuddleRoomModel?) -> [ArgusProtocol.HuddleGuestModel] {
    (room?.guests ?? []).filter { $0.state == .pending }
  }

  /// Guests the host let in. Denied guests never show in the live list.
  public static func approved(_ room: ArgusProtocol.HuddleRoomModel?) -> [ArgusProtocol.HuddleGuestModel] {
    (room?.guests ?? []).filter { $0.state == .approved }
  }

  /// Who is composing right now, for the bar above the host's own composer.
  public static func typingNames(_ room: ArgusProtocol.HuddleRoomModel?) -> [String] {
    approved(room).filter(\.typing).map(\.label)
  }

  /// What a guest is doing, in the order the desktop's guest list ranks it:
  /// driving the shared device beats waiting for it beats typing.
  public static func guestStatus(
    _ guest: ArgusProtocol.HuddleGuestModel, drivers: HuddleDrivers
  ) -> String {
    if guest.state == .pending { return "wants to join" }
    if guest.state == .approved, guest.label == drivers.holder { return "driving the device" }
    if guest.state == .approved, drivers.waiting.contains(guest.label) { return "waiting for the device" }
    if guest.typing { return "typing…" }
    return guest.connected ? "here" : "away"
  }

  /// Peacock's `TypingIndicator` phrase; the view draws the dots.
  public static func typingLine(_ names: [String]) -> String? {
    switch names.count {
    case 0: nil
    case 1: "\(names[0]) is typing"
    case 2: "\(names[0]) and \(names[1]) are typing"
    default: "\(names[0]), \(names[1]) and \(names.count - 2) others are typing"
    }
  }

  /// The sentence the engineer pastes. Degrades a phrase at a time: no name
  /// still names the agent, no title still names the sender.
  public static func inviteText(name: String, agentTitle: String, url: String) -> String {
    let who = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let what = agentTitle.trimmingCharacters(in: .whitespacesAndNewlines)
    let subject = what.isEmpty ? "an agent" : "“\(what)”"
    let sentence =
      who.isEmpty
      ? "You're invited to join \(subject) in Argus"
      : "\(who) wants you to join \(subject) in Argus"
    return url.isEmpty ? sentence : "\(sentence) — \(url)"
  }

  public static let browserClaimPrefix = "browser:"

  /// The claim key a guest would be granted, or "" when nothing is open —
  /// then the room is chat-only by circumstance.
  public static func shareableDeviceKey(
    platform: String, iosUdid: String?, androidSerial: String?, sessionId: String
  ) -> String {
    switch platform {
    case "ios": iosUdid ?? ""
    case "android": androidSerial ?? ""
    case "web": browserClaimPrefix + sessionId
    default: ""
    }
  }

  /// The name on an invite and the host's messages: the setting, else the
  /// session's git `user.name`, else nothing ("the host" on the clients).
  public static func hostName(configured: String, gitName: String?) -> String {
    let trimmed = configured.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? (gitName ?? "") : trimmed
  }
}

/// Who among the guests holds a shared device and who is bouncing off it
/// (`devices:claim-changed`). The host's own input is never arbitrated, so
/// this is for awareness only.
public struct HuddleDrivers: Equatable, Sendable {
  public var holder: String?
  public var waiting: [String]
  public static let nobody = HuddleDrivers(holder: nil, waiting: [])

  public init(holder: String?, waiting: [String]) {
    self.holder = holder
    self.waiting = waiting
  }

  public init(_ state: ArgusProtocol.RemoteDeviceClaimState) {
    self.init(holder: state.holder?.label, waiting: (state.waiting ?? []).map(\.label))
  }
}

/// Throttles "I'm typing" presence so a composer can report every keystroke
/// without flooding the host: `true` on the first key, renewed well inside the
/// host's 8s expiry, `false` once the keyboard has been quiet.
@MainActor
public final class HuddleTypingReporter {
  private let renew: Duration
  private let idle: Duration
  private let now: () -> ContinuousClock.Instant
  private let send: (Bool) -> Void
  private var typing = false
  private var lastSent: ContinuousClock.Instant?
  private var idleTask: Task<Void, Never>?

  public init(
    renew: Duration = .seconds(4), idle: Duration = .seconds(3),
    now: @escaping () -> ContinuousClock.Instant = { .now },
    send: @escaping (Bool) -> Void
  ) {
    self.renew = renew
    self.idle = idle
    self.now = now
    self.send = send
  }

  public func keystroke() {
    let at = now()
    if !typing || lastSent.map({ at - $0 >= renew }) ?? true {
      typing = true
      lastSent = at
      send(true)
    }
    idleTask?.cancel()
    let idle = idle
    idleTask = Task { [weak self] in
      try? await Task.sleep(for: idle)
      guard !Task.isCancelled else { return }
      self?.stop()
    }
  }

  /// Sent, cleared, or navigated away: drop the flag now.
  public func stop() {
    idleTask?.cancel()
    idleTask = nil
    guard typing else { return }
    typing = false
    send(false)
  }
}
