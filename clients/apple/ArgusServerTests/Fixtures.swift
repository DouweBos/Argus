import ArgusCore
import ArgusUpdate
import Foundation

@testable import Argus_Server

enum Fixtures {
  static let config = ArgusProtocol.AccountConfig(
    enabled: true, serviceUrl: "", grants: .init(ios: .control, desktop: .control),
    publish: .init(lan: true, tailscale: true, cloudflare: true), hostsCanApprove: true, tunnel: true)

  static func status(
    linked: Bool = false, name: String? = "Mini", safetyCode: String? = nil,
    link: ArgusProtocol.AccountLinkState = .idle(.init(kind: "idle")),
    config: ArgusProtocol.AccountConfig = Fixtures.config
  ) -> ArgusProtocol.AccountStatus {
    .init(linked: linked, safetyCode: safetyCode, config: config, link: link, name: name, systemName: "Mini")
  }

  static func account(
    _ status: ArgusProtocol.AccountStatus = Fixtures.status(),
    approval: ArgusProtocol.AccountApprovalState = .idle(.init(kind: "idle")),
    tunnel: ArgusProtocol.ManagedTunnelState? = .init(phase: .off, reason: .notLinked),
    requests: [ArgusProtocol.AccountJoinRequest] = [], online: Bool? = nil, notice: String? = nil
  ) -> AccountMenuSnapshot {
    .init(status: status, approval: approval, tunnel: tunnel, requests: requests, online: online, notice: notice)
  }

  static let request = ArgusProtocol.AccountJoinRequest(
    requestId: "r1", kind: "device", subjectName: "Douwe's iPhone", subjectRole: .device, subjectKind: "ios",
    status: "pending", createdAt: 0, expiresAt: 0)

  static func agent(
    _ id: String, session: String = "s1", label: String = "fix-login", project: String = "Argus",
    status: String = "running", createdAt: Double = 1
  ) -> ArgusProtocol.RemoteAgentStatus {
    let json = """
      {"agent_id":"\(id)","session_id":"\(session)","session_label":"\(label)","project_name":"\(project)",\
      "title":"Agent \(id)","status":"\(status)","created_at":\(createdAt)}
      """
    return try! JSONDecoder().decode(ArgusProtocol.RemoteAgentStatus.self, from: Data(json.utf8))
  }

  static func menu(
    host: HostSupervisor.State = .running, agents: [ArgusProtocol.RemoteAgentStatus] = [],
    account: AccountMenuSnapshot? = nil, pairing: PairingFlow.Phase = .idle,
    update: UpdateState = .idle, autoInstall: Bool = false, loginItem: LoginItemState = .off,
    legacySecrets: [String] = [], oldLoginAgent: Bool = false
  ) -> ServerMenuSnapshot {
    .init(
      version: "1.2.3", host: host, port: 47617, stateDir: "~/.argus-server", remote: nil, agents: agents,
      account: account, pairing: pairing, update: update, autoInstall: autoInstall, loginItem: loginItem,
      legacySecrets: legacySecrets, oldLoginAgent: oldLoginAgent)
  }

  static func labels(_ items: [ServerMenuItem]) -> [String] {
    items.map { $0.label ?? "---" }
  }

  static func find(_ items: [ServerMenuItem], _ label: String) -> ServerMenuItem? {
    items.first { $0.label == label }
  }

  static func children(_ item: ServerMenuItem?) -> [ServerMenuItem] {
    if case .submenu(_, let children, _)? = item { children } else { [] }
  }

  static func action(_ item: ServerMenuItem?) -> ServerMenuAction? {
    switch item {
    case .action(_, let action, _)?, .toggle(_, _, let action)?: action
    default: nil
    }
  }
}
