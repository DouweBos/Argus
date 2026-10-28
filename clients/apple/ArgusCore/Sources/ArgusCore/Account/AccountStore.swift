import ArgusKit
import Foundation
import Observation

/// The signed-in Argus account on this device: sign-in, its verified log, the
/// hosts on it with their verified presence, and linking new ones.
///
/// The service is untrusted. Everything shown here comes from the log this
/// store verified itself, against the root it pinned at genesis or resume.
@MainActor
@Observable
public final class AccountStore {
  public enum Phase: Equatable, Sendable {
    case loading
    case signedOut
    case signingIn
    /// Signed in with Clerk; creating or reading the account log.
    case settingUp
    case ready
    /// The account already has devices and this one isn't on it yet: it asks
    /// to join and waits for one of them to approve (`join`).
    case awaitingApproval
  }

  /// A host on the account, from the verified log plus verified presence.
  public struct Host: Identifiable, Equatable, Sendable {
    public var member: AccountMember
    public var endpoints: [RemoteEndpoint]
    /// Milliseconds since the epoch the service last heard from it.
    public var lastSeen: Double?
    public var online: Bool
    /// The Mac app's own bundled host.
    public var isLocal: Bool

    public var id: String { member.id }
    public var name: String { member.name }
  }

  public enum Event: Equatable, Sendable {
    case signedIn(provider: AccountSignInProvider, firstDevice: Bool)
    case signedOut
    case memberRemoved(role: AccountMember.Role)
    case memberRenamed(role: AccountMember.Role)
    /// `viaPairing`: started from a QR-paired computer rather than a typed code.
    case computerAdded(viaPairing: Bool)
    /// This device's side of a device approval (§5.4).
    case joinActed(action: JoinAction, role: JoinRole)
  }

  public enum JoinAction: String, Sendable {
    case requested, approved, denied, expired
  }

  /// Whether this device was the one joining or the one approving.
  public enum JoinRole: String, Sendable {
    case subject, approver
  }

  public internal(set) var phase: Phase = .loading
  public internal(set) var state: AccountLogState?
  public internal(set) var hosts: [Host] = []
  public internal(set) var link: LinkFlow = .idle
  /// The last thing that went wrong, for the screen to show.
  public internal(set) var error: String?
  /// Set when the service served a log that doesn't verify; the last good one stays.
  public internal(set) var logError: AccountLogRejectReason?
  /// The bundled host couldn't be put on the account (Mac only).
  public internal(set) var localLinkError: String?
  /// An email code is on its way and the next step is to type it.
  public internal(set) var awaitingEmailCode = false
  /// Who is signed in, for the account header. Never sent anywhere.
  public internal(set) var profile: AccountProfile?
  /// This device asking to join an account that already has devices.
  public internal(set) var join: JoinFlow = .idle
  /// Computers and devices waiting for an approval, proofs checked.
  public internal(set) var requests: [AccountJoinRequestInfo] = []
  /// Approving one of `requests`.
  public internal(set) var approval: ApprovalFlow = .idle

  /// How often a visible host list re-reads the directory. Well inside the
  /// online window, so a host that comes back shows within a minute.
  public static let presencePollInterval: Duration = .seconds(60)

  /// The account hosts changed; rebuild the host list.
  @ObservationIgnored public var onHostsChanged: ([DeviceIdentity]) -> Void = { _ in }
  @ObservationIgnored public var onEvent: (Event) -> Void = { _ in }
  /// This device appended entries: hand them to the hosts it is connected to
  /// (`account.sync`), so a removal doesn't wait for their next poll.
  @ObservationIgnored public var onLogAppended: () -> Void = {}

  @ObservationIgnored let auth: any AccountAuthenticating
  @ObservationIgnored let vaultStore: any AccountVaultStore
  @ObservationIgnored let client: AccountClient
  @ObservationIgnored let deviceKind: String
  @ObservationIgnored let deviceName: () -> String
  @ObservationIgnored let localHost: (any AccountLocalHostLinking)?
  @ObservationIgnored let now: () -> Date
  @ObservationIgnored var vault = AccountVault.empty
  @ObservationIgnored var configured = false
  @ObservationIgnored var pendingLink: PendingLink?
  @ObservationIgnored var pendingJoin: PendingJoin?
  @ObservationIgnored var pendingApproval: PendingLink?
  @ObservationIgnored var joinLoop: Task<Void, Never>?
  @ObservationIgnored let joinPollInterval: Duration
  @ObservationIgnored private var retryLoop: Task<Void, Never>?

  /// - Parameters:
  ///   - deviceKind: `ios` or `mac`, as the log names this device.
  ///   - localHost: the Mac app's bundled host, linked without a code.
  ///   - http: the transport to the service; tests pass a fake.
  public init(
    auth: any AccountAuthenticating,
    vault: any AccountVaultStore = KeychainAccountVault(),
    deviceKind: String,
    deviceName: @escaping () -> String,
    localHost: (any AccountLocalHostLinking)? = nil,
    baseURL: URL = AccountClient.configuredBaseURL(),
    http: AccountClient.HTTP? = nil,
    now: @escaping () -> Date = Date.init,
    joinPollInterval: Duration = .seconds(3)
  ) {
    self.auth = auth
    vaultStore = vault
    self.deviceKind = deviceKind
    self.deviceName = deviceName
    self.localHost = localHost
    self.now = now
    self.joinPollInterval = joinPollInterval
    client = AccountClient(baseURL: baseURL, token: { [auth] in try await auth.token() }, http: http)
  }

  public var isSignedIn: Bool { phase == .ready }
  public var memberId: String? { vault.keys?.memberId }
  public var safetyCode: String? { state?.root.safetyCode }

  /// Devices and hosts on the account, oldest first.
  public var members: [AccountMember] { state?.liveMembers ?? [] }

  public func host(_ hostId: String) -> Host? { hosts.first { $0.id == hostId } }

  // MARK: Lifecycle

  /// Read back what this device already trusts, then reach the service. The
  /// hosts show from the cache straight away, so an offline launch still lists them.
  public func start() async {
    vault = await vaultStore.load()
    if let root = vault.root, case .ok(let verified) = AccountLog.verify(vault.entries, root: root),
      ownMemberLive(in: verified)
    {
      state = verified
      phase = .ready
      publishHosts()
    }
    do {
      try await ensureConfigured()
    } catch {
      if phase == .loading { phase = .signedOut }
      return
    }
    refreshProfile()
    if phase == .ready {
      await refresh()
      await linkLocalHostIfNeeded()
    } else if auth.isSignedIn {
      await bootstrap(provider: nil)
    } else {
      phase = .signedOut
    }
  }

  /// The app came to the foreground: pick up new entries and moved addresses.
  public func refresh() async {
    guard phase == .ready else { return }
    refreshProfile()
    await refreshLog()
    await refreshDirectory()
    await refreshRequests()
  }

  /// Re-read the signed-in person from the sign-in provider.
  public func refreshProfile() {
    profile = configured && auth.isSignedIn ? auth.profile : nil
  }

  /// While a connection to an account host keeps failing, poll the directory
  /// so a restarted tunnel's new address is found within a minute.
  public func setConnectionFailing(_ failing: Bool) {
    retryLoop?.cancel()
    retryLoop = nil
    guard failing else { return }
    retryLoop = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(30))
        guard !Task.isCancelled, let self else { return }
        await self.refreshDirectory()
      }
    }
  }

  // MARK: Sign-in

  public func signIn(with provider: AccountSignInProvider) async {
    guard provider != .email else { return }
    await runSignIn(provider) {
      if provider == .apple {
        try await self.auth.signInWithApple(idToken: nil)
      } else {
        try await self.auth.signInWithGitHub()
      }
    }
  }

  /// The system Sign in with Apple button already has the identity token.
  public func signInWithApple(idToken: String) async {
    await runSignIn(.apple) { try await self.auth.signInWithApple(idToken: idToken) }
  }

  /// The configured auth provider, before a sign-in button is shown.
  public func prepare() async {
    try? await ensureConfigured()
  }

  public func sendEmailCode(_ email: String) async {
    error = nil
    do {
      try await ensureConfigured()
      try await auth.sendEmailCode(email)
      awaitingEmailCode = true
    } catch {
      self.error = Self.describe(error)
    }
  }

  public func verifyEmailCode(_ code: String) async {
    await runSignIn(.email) { try await self.auth.verifyEmailCode(code) }
    if phase != .signedOut { awaitingEmailCode = false }
  }

  public func cancelEmailCode() {
    awaitingEmailCode = false
    error = nil
  }

  private func runSignIn(_ provider: AccountSignInProvider, _ flow: () async throws -> Void) async {
    error = nil
    phase = .signingIn
    do {
      try await ensureConfigured()
      try await flow()
      refreshProfile()
    } catch {
      self.error = Self.describe(error)
      phase = .signedOut
      return
    }
    await bootstrap(provider: provider)
  }

  func ensureConfigured() async throws {
    guard !configured else { return }
    let config = try await client.config()
    try await auth.configure(publishableKey: config.clerkPublishableKey)
    configured = true
  }

  /// Signed in with Clerk: write genesis on an empty account, resume when this
  /// device is already on it, and otherwise wait for approval.
  func bootstrap(provider: AccountSignInProvider?) async {
    phase = .settingUp
    do {
      let info = try await client.account()
      if vault.root.map({ $0.accountId != info.accountId || $0.epoch != info.epoch }) ?? false {
        vault = AccountVault(keys: vault.keys)
      }
      var firstDevice = false
      if info.headSeq == nil {
        firstDevice = try await writeGenesis(info)
      }
      if !firstDevice {
        guard try await resume(info) else {
          phase = .awaitingApproval
          await requestJoin(info, provider: provider)
          return
        }
      }
      phase = .ready
      publishHosts()
      if let provider { onEvent(.signedIn(provider: provider, firstDevice: firstDevice)) }
      await linkLocalHostIfNeeded()
      await refreshDirectory()
    } catch {
      self.error = Self.describe(error)
      phase = .signedOut
    }
  }

  /// The first device on the account (TOFU): its own genesis, pinned.
  /// False when another device won the race and the account isn't empty after all.
  private func writeGenesis(_ info: AccountInfo) async throws -> Bool {
    let keys = vault.keys ?? AccountDeviceKeys.generate(kind: deviceKind, name: deviceName(), now: now())
    guard let signer = keys.signer else { throw AccountStoreError.keys }
    let genesis = try AccountEntryBuilder.make(
      accountId: info.accountId, epoch: info.epoch, head: nil, ts: nowMs(), signer: signer,
      .genesis(member: keys.member))
    do {
      try await client.append(epoch: info.epoch, entries: [genesis])
    } catch AccountServiceError.conflict {
      vault.keys = keys
      return false
    }
    guard case .ok(let verified) = AccountLog.verify([genesis]) else { throw AccountStoreError.keys }
    vault = AccountVault(keys: keys, root: verified.root, entries: [genesis])
    state = verified
    await vaultStore.save(vault)
    return true
  }

  /// This device's key is live in the account's log: adopt it.
  private func resume(_ info: AccountInfo) async throws -> Bool {
    let entries = try await client.log(epoch: info.epoch, after: -1)
    switch AccountLog.verify(entries, root: vault.root) {
    case .ok(let verified):
      // Never pinned: only this device's own genesis, or an approval carrying
      // the code compared here, counts.
      guard ownMemberLive(in: verified),
        vault.root != nil || admitsConfirmedJoin(verified) || wroteGenesis(verified)
      else { return false }
      vault.root = verified.root
      vault.joinRequestId = nil
      vault.joinCommit = nil
      vault.entries = entries
      state = verified
      logError = nil
      await vaultStore.save(vault)
      return true
    case .rejected(let reason, _, _):
      logError = reason
      throw AccountStoreError.untrustedLog
    }
  }

  func wroteGenesis(_ state: AccountLogState) -> Bool {
    guard let id = vault.keys?.memberId else { return false }
    return state.members[id]?.addedBy == id
  }

  func ownMemberLive(in state: AccountLogState) -> Bool {
    guard let keys = vault.keys, let found = state.liveMember(keys.memberId) else { return false }
    return found.member.signPub == keys.signPub
  }

  /// Sign out = take this device off the account, forget its keys, end the
  /// Clerk session. Hosts it was QR-paired with are unaffected.
  public func signOut() async {
    if let pending = pendingJoin {
      try? await client.deny(requestId: pending.requestId)
    }
    if phase == .ready, let memberId = vault.keys?.memberId {
      // Not applied: the store is forgotten right after, and adopting a log
      // without this device would read as being removed.
      try? await appendWithRetry(apply: false) { [self] head in
        [try entry(head: head, .revoke(memberId: memberId, reason: "unlinked"))]
      }
    }
    try? await auth.signOut()
    await forgetAccount()
    onEvent(.signedOut)
  }

  func forgetAccount() async {
    vault = .empty
    await vaultStore.save(vault)
    state = nil
    hosts = []
    profile = nil
    link = .idle
    pendingLink = nil
    stopJoin()
    join = .idle
    requests = []
    approval = .idle
    pendingApproval = nil
    phase = .signedOut
    onHostsChanged([])
  }

  func nowMs() -> Int64 { Int64((now().timeIntervalSince1970 * 1000).rounded()) }

  static func describe(_ error: Error) -> String {
    if let service = error as? AccountServiceError { return service.message }
    if let store = error as? AccountStoreError { return store.message }
    return error.localizedDescription
  }
}

public enum AccountStoreError: Error, Equatable {
  case keys
  case untrustedLog
  case notReady
  case headMoved

  var message: String {
    switch self {
    case .keys: "This device's account keys couldn't be used."
    case .untrustedLog: "The account service sent a log that doesn't check out, so nothing was changed."
    case .notReady: "Sign in first."
    case .headMoved: "Your account changed while this was open. Try again."
    }
  }
}

/// The Mac app's bundled host, linked to the account over its local socket
/// with no code: both ends are the same user on the same machine (§5.2b).
@MainActor
public protocol AccountLocalHostLinking: AnyObject {
  /// The host's member record and its proof of possession.
  func begin() async throws -> (host: AccountMember, proof: String)
  /// The `add_host` is in the log; the host fetches, verifies and pins it.
  func finish(root: AccountRoot) async throws
}
