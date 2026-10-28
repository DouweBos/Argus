import ArgusCore
import ArgusMenuBar
import ArgusUpdate
import Foundation

@testable import Argus_Server

enum Fixtures {
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

  static func labels(_ items: [HostMenuItem]) -> [String] {
    items.map { $0.label ?? "---" }
  }

  static func find(_ items: [HostMenuItem], _ label: String) -> HostMenuItem? {
    items.first { $0.label == label }
  }

  static func children(_ item: HostMenuItem?) -> [HostMenuItem] {
    if case .submenu(_, let children, _)? = item { children } else { [] }
  }

  static func action(_ item: HostMenuItem?) -> HostMenuAction? {
    switch item {
    case .action(_, let action, _)?, .toggle(_, _, let action)?: action
    default: nil
    }
  }
}
