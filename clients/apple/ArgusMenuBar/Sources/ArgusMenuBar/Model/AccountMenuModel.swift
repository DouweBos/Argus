import ArgusCore
import Foundation

/// The account section of the menu, line for line the Electron server tray's
/// (`electron/services/tray/accountMenu.ts`), so the docs describe one menu.
public struct AccountMenuSnapshot: Sendable {
  public var status: ArgusProtocol.AccountStatus
  public var approval: ArgusProtocol.AccountApprovalState
  public var tunnel: ArgusProtocol.ManagedTunnelState?
  public var requests: [ArgusProtocol.AccountJoinRequest]
  /// This computer as the account service sees it; nil until first checked.
  public var online: Bool?
  /// The last action's failure, shown until dismissed or the next action.
  public var notice: String?
  /// The server manages the account from its menu; the Mac app from Settings.
  public var inlineSettings: Bool

  public init(
    status: ArgusProtocol.AccountStatus, approval: ArgusProtocol.AccountApprovalState,
    tunnel: ArgusProtocol.ManagedTunnelState?, requests: [ArgusProtocol.AccountJoinRequest], online: Bool?,
    notice: String?, inlineSettings: Bool = true
  ) {
    self.status = status
    self.approval = approval
    self.tunnel = tunnel
    self.requests = requests
    self.online = online
    self.notice = notice
    self.inlineSettings = inlineSettings
  }
}

public enum AccountMenuModel {
  public static func items(_ s: AccountMenuSnapshot) -> [HostMenuItem] {
    var out: [HostMenuItem] = []
    if let notice = s.notice {
      out += [.info(notice), .action("Dismiss", .account(.noticeDismiss))]
    }
    if !s.status.linked, let reset = s.status.reset, case .idle = s.status.link {
      let by = reset.byName.map { " from \"\($0)\"" } ?? ""
      return out + [
        .info("This account was reset\(by)"),
        .info("Link this computer again to keep using it"),
        .action("Link to Argus Account…", .account(.linkStart)),
        .action("Dismiss", .account(.resetDismiss)),
      ]
    }
    guard s.status.linked else { return out + linkItems(s) }
    out.append(.info(s.status.name.map { "Argus Account: linked as \"\($0)\"" } ?? "Argus Account: linked"))
    out.append(.info(presenceLine(s)))
    out.append(.info(tunnelLine(s.tunnel)))
    out += approvalItems(s)
    out += waitingItems(s)
    out.append(settingsItem(s))
    return out
  }

  public static func tunnelLine(_ tunnel: ArgusProtocol.ManagedTunnelState?) -> String {
    guard let tunnel else { return "Managed tunnel: off" }
    switch tunnel.phase {
    case .running:
      return tunnel.url.map { "Managed tunnel: \(withoutScheme($0))" } ?? "Managed tunnel: running"
    case .off:
      if tunnel.reason == .remoteOff { return "Managed tunnel: off (remote access is off)" }
      return tunnel.reason == .accountPaused ? "Managed tunnel: paused" : "Managed tunnel: off"
    case .installing:
      return "Managed tunnel: installing cloudflared…"
    case .provisioning, .starting:
      return "Managed tunnel: starting…"
    case .unavailable:
      return "Managed tunnel: unavailable"
    case .error:
      return "Managed tunnel: failed"
    default:
      return "Managed tunnel: \(tunnel.phase.rawValue)"
    }
  }

  public static func spaced(_ sas: String) -> String {
    guard sas.count > 3 else { return sas }
    return "\(sas.prefix(3)) \(sas.dropFirst(3))"
  }

  public static func withoutScheme(_ url: String) -> String {
    var out = url
    if let range = out.range(of: "^[a-zA-Z]+://", options: .regularExpression) { out.removeSubrange(range) }
    if out.hasSuffix("/") { out.removeLast() }
    return out
  }

  public static func noun(_ role: ArgusProtocol.AccountMemberRole) -> String {
    role == .host ? "computer" : "device"
  }

  private static func presenceLine(_ s: AccountMenuSnapshot) -> String {
    guard s.status.config.enabled else { return "Account paused on this computer" }
    guard let online = s.online else { return "Checking whether it's online…" }
    return online ? "Online" : "Offline — the account hasn't seen it lately"
  }

  private static func linkItems(_ s: AccountMenuSnapshot) -> [HostMenuItem] {
    let cancel = HostMenuItem.action("Cancel Linking", .account(.linkCancel))
    let start = HostMenuItem.action("Link to Argus Account…", .account(.linkStart))
    switch s.status.link {
    case .awaitingClaim(let claim):
      let site = withoutScheme(claim.verificationUri)
      return [
        .info("Enter \(claim.userCode) at \(site)"),
        .info("or type it into the Argus app on your phone or Mac"),
        .action("Copy Code", .account(.linkCopyCode(claim.userCode))),
        .action("Open \(site)", .account(.linkOpen(claim.verificationUriComplete))),
        cancel,
      ]
    case .awaitingFirst:
      return [
        .info("Your account has no computers yet"),
        .action("Make This Computer the First", .account(.linkConfirm(match: true))),
        cancel,
      ]
    case .awaitingSas(let sas):
      return [
        .info("Approval requested by \"\(sas.approverName)\""),
        .info("Confirm this matches: \(spaced(sas.sas))"),
        .action("Codes Match — Link", .account(.linkConfirm(match: true))),
        .action("Codes Differ — Cancel", .account(.linkConfirm(match: false))),
      ]
    case .awaitingApproval:
      return [.info("Confirmed here. Waiting for the other side…"), cancel]
    case .error(let error):
      return [.info("Linking failed: \(error.message)"), start]
    case .idle, .linked, .unknown:
      return [start]
    }
  }

  private static func approvalItems(_ s: AccountMenuSnapshot) -> [HostMenuItem] {
    let dismiss = HostMenuItem.action("Dismiss", .account(.approvalDismiss))
    switch s.approval {
    case .awaitingSas(let approval):
      return [
        .info("Approving \"\(approval.subjectName)\" (\(noun(approval.subjectRole)))"),
        .info("Confirm this matches: \(spaced(approval.sas))"),
        .action("Codes Match — Approve", .account(.approvalConfirm(match: true))),
        .action("Codes Differ — Deny", .account(.approvalConfirm(match: false))),
      ]
    case .approved(let approved):
      return [.info("Approved. That \(noun(approved.subjectRole)) is now on your account"), dismiss]
    case .error(let error):
      return [.info("Approval failed: \(error.message)"), dismiss]
    case .idle, .unknown:
      return []
    }
  }

  private static func waitingItems(_ s: AccountMenuSnapshot) -> [HostMenuItem] {
    let n = s.requests.count
    guard n > 0 else { return [] }
    // Approving here is switched off: say why rather than hide the queue.
    guard s.status.config.hostsCanApprove else {
      return [.info("Waiting to join (\(n)) — approving here is off")]
    }
    let busy = if case .awaitingSas = s.approval { true } else { false }
    return [
      .submenu(
        "Waiting to join (\(n))",
        s.requests.map { request in
          .submenu(
            "\(request.subjectName) (\(noun(request.subjectRole)))",
            [
              .action("Approve…", .account(.approve(requestId: request.requestId))),
              .action("Deny", .account(.deny(requestId: request.requestId))),
            ])
        },
        enabled: !busy)
    ]
  }

  private static func settingsItem(_ s: AccountMenuSnapshot) -> HostMenuItem {
    guard s.inlineSettings else { return .action("Account Settings…", .openAccountSettings) }
    let status = s.status
    var submenu: [HostMenuItem] = []
    if let safety = status.safetyCode {
      submenu += [.info("Account safety code: \(safety)"), .separator]
    }
    submenu.append(.toggle("Managed Tunnel", isOn: status.config.tunnel, .account(.tunnel(on: !status.config.tunnel))))
    submenu.append(.action("This Computer's Name…", .account(.rename(current: status.name ?? status.systemName ?? ""))))
    if let system = status.systemName, status.name != system {
      submenu.append(.action("Use System Name (\(system))", .account(.renameDefault)))
    }
    submenu += [.separator, .action("Unlink…", .account(.unlink))]
    return .submenu("Argus Account", submenu)
  }
}
