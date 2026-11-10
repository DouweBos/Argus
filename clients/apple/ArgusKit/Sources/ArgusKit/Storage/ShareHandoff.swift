import Foundation

/// What the share extension needs from the app: the computers it may reach and
/// the defaults a start from the phone uses. The app mirrors it whenever they
/// change; the extension is a separate process and can't read the app's keychain.
public struct ShareSnapshot: Codable, Sendable, Equatable {
  public var hosts: [DeviceIdentity]
  public var activeId: String?
  public var defaultPermissionMode: String?
  public var theme: String?
  public var colorTheme: String?

  public init(
    hosts: [DeviceIdentity], activeId: String?, defaultPermissionMode: String? = nil, theme: String? = nil,
    colorTheme: String? = nil
  ) {
    self.hosts = hosts
    self.activeId = activeId
    self.defaultPermissionMode = defaultPermissionMode
    self.theme = theme
    self.colorTheme = colorTheme
  }
}

/// The app ↔ share extension handoff, through the App Group. The snapshot holds
/// pairing keys, so it goes in the group's keychain; outcomes are plain defaults.
public struct ShareHandoff: Sendable {
  public static let maxOutcomes = 20
  private static let snapshotAccount = "argus.share.snapshot"
  private static let outcomesKey = "argus.share.outcomes"

  private let keystore: Keystore
  private let appGroup: String

  public init(appGroup: String = ArgusSeal.appGroup) {
    self.appGroup = appGroup
    keystore = Keystore(service: "dev.houwert.argus.share", accessGroup: appGroup)
  }

  public func loadSnapshot() async -> ShareSnapshot? {
    guard let data = await keystore.readItem(Self.snapshotAccount) else { return nil }
    return try? JSONDecoder().decode(ShareSnapshot.self, from: data)
  }

  /// No computers removes the item, so an unpaired phone leaves no keys behind.
  public func saveSnapshot(_ snapshot: ShareSnapshot) async {
    guard !snapshot.hosts.isEmpty else { return await keystore.deleteItem(Self.snapshotAccount) }
    guard let data = try? JSONEncoder().encode(snapshot) else { return }
    await keystore.writeItem(data, account: Self.snapshotAccount)
  }

  // MARK: Outcomes

  /// How a share ended, for the app to report: the extension has no telemetry of its own.
  public struct Outcome: Codable, Sendable, Equatable {
    public enum Result: String, Codable, Sendable {
      case started, cancelled, unreachable, unpaired
    }

    public var result: Result
    public var hasImages: Bool
    public var hasLink: Bool
    public var hasText: Bool
    /// `worktree`, `existing` or `current` once started; nil otherwise.
    public var workspace: String?

    public init(result: Result, hasImages: Bool, hasLink: Bool, hasText: Bool, workspace: String? = nil) {
      self.result = result
      self.hasImages = hasImages
      self.hasLink = hasLink
      self.hasText = hasText
      self.workspace = workspace
    }
  }

  private var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

  public func record(_ outcome: Outcome) {
    var all = pendingOutcomes()
    all.append(outcome)
    let kept = Array(all.suffix(Self.maxOutcomes))
    defaults?.set(try? JSONEncoder().encode(kept), forKey: Self.outcomesKey)
  }

  /// Everything recorded since the last drain, oldest first.
  public func drainOutcomes() -> [Outcome] {
    let all = pendingOutcomes()
    defaults?.removeObject(forKey: Self.outcomesKey)
    return all
  }

  private func pendingOutcomes() -> [Outcome] {
    guard let data = defaults?.data(forKey: Self.outcomesKey) else { return [] }
    return (try? JSONDecoder().decode([Outcome].self, from: data)) ?? []
  }
}
