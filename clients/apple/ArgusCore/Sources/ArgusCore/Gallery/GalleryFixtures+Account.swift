import ArgusKit
import Foundation

/// An Argus account as a gallery story shows it, the same on the Mac and the phone.
public struct GalleryAccount: Sendable {
  public var phase: AccountStore.Phase
  /// `ios` or `mac`: which device on the account is this one.
  public var selfKind: String
  public var requests: Bool
  public var error: String?
  /// Signed out because another device removed this one.
  public var removed: Bool
  /// On the account, but an identity action asked for the sign-in it doesn't hold.
  public var signInNeeded: AccountStore.IdentityAction?
  /// The Mac's own host is on another account, so This Mac offers the move.
  public var hostElsewhere: Bool

  public init(
    phase: AccountStore.Phase = .ready, selfKind: String, requests: Bool = true, error: String? = nil,
    removed: Bool = false, signInNeeded: AccountStore.IdentityAction? = nil, hostElsewhere: Bool = false
  ) {
    self.phase = phase
    self.selfKind = selfKind
    self.requests = requests
    self.error = error
    self.removed = removed
    self.signInNeeded = signInNeeded
    self.hostElsewhere = hostElsewhere
  }
}

extension AccountStore {
  /// Fills the store for a gallery story; it never reaches the keychain or the service after.
  public func galleryFill(_ fixture: GalleryAccount) {
    galleryFrozen = true
    configured = true
    phase = fixture.phase
    error = fixture.error
    removed = fixture.removed
    signInNeeded = fixture.signInNeeded
    guard fixture.phase == .ready || fixture.phase == .awaitingApproval else { return }
    profile = AccountProfile(firstName: "Alex", lastName: "Rivera", email: "alex.rivera@example.com")
    let members = GalleryFixtures.accountMembers
    let selfId = members.first { $0.role == .device && $0.kind == fixture.selfKind }?.id ?? ""
    vault = AccountVault(
      keys: AccountDeviceKeys(
        memberId: selfId, signSeed: "", signPub: "", noisePriv: "", noisePub: "", kind: fixture.selfKind, name: "",
        createdAt: 0),
      presence: GalleryFixtures.accountPresence(now: now()),
      localHostId: fixture.selfKind == "mac" && !fixture.hostElsewhere ? "h-local" : nil)
    if fixture.hostElsewhere {
      localLinkConflict = true
      localLinkError = "This Mac's host is on another Argus account."
    }
    guard fixture.phase == .ready else { return }
    state = AccountLogState(
      accountId: "acct-gallery", epoch: 1, genesisHash: "5f2c9e81b07a4d6e93c1a2b4f8d0e7c6",
      head: AccountHead(seq: members.count, hash: "h"),
      members: Dictionary(
        uniqueKeysWithValues: members.map {
          ($0.id, AccountMemberState(member: $0, live: true, requestId: "", sasCommit: "", addedBy: $0.id))
        }))
    publishHosts()
    if fixture.requests {
      requests = [
        AccountJoinRequestInfo(
          requestId: "r1", kind: "device",
          subject: AccountRequestSubject(
            device: .device(
              id: "d-new", kind: "ios", signPub: "", noisePub: "", name: "Alex's iPad mini", createdAt: 0),
            proofs: [:]))
      ]
    }
  }
}

extension GalleryFixtures {
  static let accountMembers: [AccountMember] = {
    let day = 86_400_000.0
    let start = 1_760_000_000_000.0
    func host(_ id: String, _ name: String, _ platform: String, _ age: Double) -> AccountMember {
      AccountMember(
        id: id, role: .host, platform: platform, signPub: "sign-\(id)", noisePub: "noise-\(id)", name: name,
        createdAt: start + age * day)
    }
    func device(_ id: String, _ kind: String, _ name: String, _ age: Double) -> AccountMember {
      .device(
        id: id, kind: kind, signPub: "sign-\(id)", noisePub: "noise-\(id)", name: name, createdAt: start + age * day)
    }
    return [
      host("h-local", "Alex's MacBook Pro", "darwin", 0),
      device("d-mac", "mac", "Alex's MacBook Pro", 0),
      device("d-ios", "ios", "Alex's iPhone", 1),
      host("h-studio", "Studio Mac mini", "darwin", 3),
      host("h-build", "build-box-ubuntu-24-04-ci-runner", "linux", 9),
      device("d-ipad", "ios", "iPad Pro", 12),
      device("d-web", "web", "Chrome on the studio display", 20),
    ]
  }()

  static func accountPresence(now: Date) -> [String: AccountCachedPresence] {
    let ms = now.timeIntervalSince1970 * 1000
    let lan = RemoteEndpoint(kind: .lan, url: "ws://192.168.1.24:7421", priority: 0)
    return [
      "h-local": AccountCachedPresence(ts: ms, lastSeen: ms - 20_000, endpoints: [lan]),
      "h-studio": AccountCachedPresence(ts: ms, lastSeen: ms - 45_000, endpoints: [lan]),
      "h-build": AccountCachedPresence(ts: ms, lastSeen: ms - 3 * 3_600_000, endpoints: []),
    ]
  }
}

extension GalleryFixtures {
  /// A connected computer's device hosts: two SSH Macs, one unreachable, and an EAS host.
  public static var deviceHosts: [String: String] {
    [
      RemoteMethod.deviceHostsList.rawValue: GalleryJSON.encode([
        "hosts": [
          ["id": "ssh-studio", "label": "Studio Mac mini", "status": "connected", "kind": "ssh"],
          ["id": "ssh-lab", "label": "lab-mac-pro-simulator-farm.local", "status": "unreachable", "kind": "ssh"],
          [
            "id": "eas", "label": "EAS Simulator", "status": "connected", "kind": "eas", "running_sessions": 1,
            "max_sessions": 2,
          ],
        ]
      ])
    ]
  }
}
