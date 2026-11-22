import ArgusKit
import Foundation

/// One session's agents as its tabs show them: working, waiting, paused and pinned.
extension GalleryFixtures {
  public static var agentTabs: [RemoteAgentStatus] {
    let json: [[String: Any]] = [
      tab("a-tab-run", "Fix the sidebar", status: "running", minutes: 1),
      tab("a-tab-wait", "Release notes", status: "requires_action", awaiting: "permission", minutes: 4),
      tab("a-tab-paused", "Token audit", status: "idle", minutes: 95, paused: true),
      tab("a-tab-pin", "Triage", status: "idle", minutes: 12, pinned: true),
      tab("a-tab-both", "On call", status: "idle", minutes: 260, pinned: true, paused: true),
    ]
    return (try? ProtocolCodec.decoder.decode([RemoteAgentStatus].self, from: JSONSerialization.data(withJSONObject: json)))
      ?? []
  }

  private static func tab(
    _ id: String, _ title: String, status: String, awaiting: String? = nil, minutes: Double, pinned: Bool = false,
    paused: Bool = false
  ) -> [String: Any] {
    var json = agent(
      id, session: "s-pr", label: "Watch pull request tool", title: title, status: status, awaiting: awaiting,
      minutes: minutes)
    if pinned { json["pinned"] = true }
    if paused { json["paused"] = true }
    return json
  }
}
