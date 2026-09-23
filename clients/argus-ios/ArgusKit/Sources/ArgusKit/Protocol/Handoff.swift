import Foundation

/// The Handoff contract shared with the desktop.
///
/// The two apps address screens differently — the desktop is session-centric,
/// this one agent-centric — so the activity carries identifiers rather than a
/// URL and each side maps them onto its own navigation. `hostKey` is the
/// desktop's Noise static public key: every pairing already pins it, so it
/// names *which computer* without inventing a second identity.
///
/// Keys and values are plain strings because `NSUserActivity.userInfo` has to
/// be property-list types, and the desktop writes them from JavaScript.
public struct Handoff: Sendable, Equatable {
  public static let activityType = "dev.houwert.argus.session"

  public var hostKey: String
  public var sessionId: String
  public var agentId: String?
  public var label: String?
  public var projectName: String?
  public var repoRoot: String?

  public init(
    hostKey: String,
    sessionId: String,
    agentId: String? = nil,
    label: String? = nil,
    projectName: String? = nil,
    repoRoot: String? = nil
  ) {
    self.hostKey = hostKey
    self.sessionId = sessionId
    self.agentId = agentId
    self.label = label
    self.projectName = projectName
    self.repoRoot = repoRoot
  }

  public enum Key {
    public static let hostKey = "hostKey"
    public static let sessionId = "sessionId"
    public static let agentId = "agentId"
    public static let label = "label"
    public static let projectName = "projectName"
    public static let repoRoot = "repoRoot"
  }

  public var userInfo: [String: String] {
    var info = [Key.hostKey: hostKey, Key.sessionId: sessionId]
    info[Key.agentId] = agentId
    info[Key.label] = label
    info[Key.projectName] = projectName
    info[Key.repoRoot] = repoRoot

    return info
  }

  /// A handoff without a computer or a session names nothing openable.
  public init?(userInfo: [AnyHashable: Any]?) {
    guard let userInfo,
      let hostKey = userInfo[Key.hostKey] as? String,
      let sessionId = userInfo[Key.sessionId] as? String
    else { return nil }
    self.init(
      hostKey: hostKey,
      sessionId: sessionId,
      agentId: userInfo[Key.agentId] as? String,
      label: userInfo[Key.label] as? String,
      projectName: userInfo[Key.projectName] as? String,
      repoRoot: userInfo[Key.repoRoot] as? String)
  }

  /// The desktop encodes its key base64url, a pairing stores it as standard
  /// base64 — compare the bytes, not the spelling.
  public func names(desktopKey stored: String) -> Bool {
    guard let mine = ArgusBase64.decodeURL(hostKey),
      let theirs = ArgusBase64.decode(stored)
    else { return false }

    return mine == theirs
  }
}
