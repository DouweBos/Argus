import AppKit
import ArgusCore
import Foundation
import Observation

/// The account section's live state and actions, over this Mac's host socket.
/// Every action calls the host command the Electron tray's console words
/// reach, so the menus can't drift. Each app wires the hooks.
@MainActor
@Observable
public final class HostAccountMenu {
  public let link: HostLinkModel
  public var account: ArgusProtocol.AccountStatus?
  public var approval: ArgusProtocol.AccountApprovalState = .idle(.init(kind: "idle"))
  public private(set) var requests: [ArgusProtocol.AccountJoinRequest] = []
  public private(set) var online: Bool?
  /// The last account action's failure, shown until dismissed.
  public var notice: String?

  /// The host to ask, read at each action: it may come up after the menu.
  @ObservationIgnored public var backend: @MainActor () -> (any HostBackend)? = { nil }
  /// A window to bring forward (the link code, a join to approve).
  @ObservationIgnored public var onShow: (@MainActor (HostMenuWindow) -> Void)?
  /// An action went through, after any confirmation: for telemetry.
  @ObservationIgnored public var onPerformed: (@MainActor (AccountMenuAction) -> Void)?
  /// A join request the menu hadn't seen before.
  @ObservationIgnored public var onNewRequest: (@MainActor (ArgusProtocol.AccountJoinRequest) -> Void)?

  public init(surface: ArgusProtocol.AccountLinkSurface) {
    link = HostLinkModel(surface: surface)
  }

  public func snapshot(tunnel: ArgusProtocol.ManagedTunnelState?, inlineSettings: Bool = true) -> AccountMenuSnapshot? {
    account.map {
      AccountMenuSnapshot(
        status: $0, approval: approval, tunnel: tunnel, requests: $0.linked ? requests : [],
        online: $0.linked ? online : nil, notice: notice, inlineSettings: inlineSettings)
    }
  }

  // MARK: Host events

  /// An `account:*` host event; true when it was one.
  @discardableResult
  public func handle(channel: String, payload: JSONValue) -> Bool {
    switch channel {
    case "account:status":
      let wasLinked = account?.linked
      if let next = try? ProtocolCodec.convert(payload, to: ArgusProtocol.AccountStatus.self) {
        account = next
        if next.linked != wasLinked { Task { await refreshRequests() } }
      }
    case "account:link-state":
      if let next = try? ProtocolCodec.convert(payload, to: ArgusProtocol.AccountLinkState.self) {
        account?.link = next
        link.observe(next)
      }
    case "account:approval-state":
      if let next = try? ProtocolCodec.convert(payload, to: ArgusProtocol.AccountApprovalState.self) {
        approval = next
      }
    default:
      return false
    }
    return true
  }

  // MARK: Refresh

  public func refreshAccount() async {
    guard let backend = backend() else { return }
    account = (try? await backend.request(ArgusProtocol.Commands.AccountGetStatus.self, EmptyParams())) ?? account
  }

  /// Join requests and this computer's presence; both need the network.
  public func refreshRequests() async {
    guard let backend = backend(), let account, account.linked, account.config.enabled else {
      requests = []
      online = nil
      return
    }
    let previous = Set(requests.map(\.requestId))
    async let nextRequests = try? backend.request(ArgusProtocol.Commands.AccountListRequests.self, EmptyParams())
    async let hosts = try? backend.request(ArgusProtocol.Commands.AccountListHosts.self, EmptyParams())
    requests = await nextRequests ?? requests
    online = await hosts?.first(where: \.isSelf)?.online ?? online
    for request in requests where !previous.contains(request.requestId) {
      onNewRequest?(request)
    }
  }

  // MARK: Actions

  public func run(_ action: AccountMenuAction) {
    notice = nil
    Task {
      do {
        try await perform(action)
      } catch {
        notice = HostStore.describe(error)
      }
    }
  }

  private func perform(_ action: AccountMenuAction) async throws {
    guard let backend = backend() else { return }
    switch action {
    case .linkStart:
      onPerformed?(action)
      await link.start(backend)
      linkMoved()
      if case .awaitingClaim(let claim)? = link.state { Self.copy(claim.userCode) }
      onShow?(.link)
    case .linkCopyCode(let code):
      Self.copy(code)
    case .linkOpen(let url):
      if let url = URL(string: url) { NSWorkspace.shared.open(url) }
    case .linkConfirm(let match):
      await link.confirm(match)
      linkMoved()
    case .linkCancel:
      await link.cancel()
      linkMoved()
    case .approve(let requestId):
      onPerformed?(action)
      approval = try await backend.request(ArgusProtocol.Commands.AccountApproveJoin.self, .init(requestId: requestId))
      onShow?(.approval)
    case .deny(let requestId):
      onPerformed?(action)
      try await backend.request(ArgusProtocol.Commands.AccountDenyJoin.self, .init(requestId: requestId))
      await refreshRequests()
    case .approvalConfirm(let match):
      approval = try await backend.request(ArgusProtocol.Commands.AccountConfirmJoin.self, .init(match: match))
      await refreshRequests()
    case .approvalDismiss:
      // The host has no "dismiss"; its next approval replaces this one.
      approval = .idle(.init(kind: "idle"))
    case .tunnel(let on):
      onPerformed?(action)
      account = try await backend.request(ArgusProtocol.Commands.AccountSetConfig.self, .init(patch: .init(tunnel: on)))
    case .rename(let current):
      guard let name = HostMenuPrompts.computerName(current: current), name != current else { return }
      onPerformed?(action)
      account = try await backend.request(ArgusProtocol.Commands.AccountSetName.self, .init(name: name))
    case .renameDefault:
      onPerformed?(action)
      account = try await backend.request(ArgusProtocol.Commands.AccountSetName.self, .init(name: nil))
    case .unlink:
      guard HostMenuPrompts.confirmUnlink() else { return }
      onPerformed?(action)
      account = try await backend.request(ArgusProtocol.Commands.AccountLogout.self, EmptyParams())
    case .noticeDismiss:
      return
    }
  }

  /// The link model holds the host's answer; the menu reads the status.
  private func linkMoved() {
    if let state = link.state { account?.link = state }
    if let failure = link.failure { notice = failure }
  }

  public static func copy(_ text: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
  }
}
