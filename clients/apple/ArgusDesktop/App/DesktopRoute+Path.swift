import Foundation

/// Paths as `docs/routing.md` spells them, for deep links (`argus://…`) and
/// `ARGUS_DEV_ROUTE`. Git's sub-routes join this parser when they land.
extension DesktopRoute {
  init?(path raw: String) {
    let path = raw.split(separator: "?", maxSplits: 1).first.map(String.init) ?? raw
    let parts = path.split(separator: "/").map { $0.removingPercentEncoding ?? String($0) }
    switch (parts.first, parts.count) {
    case (nil, _): self = .home
    case ("agents", 1): self = .agents
    case ("runtimes", 1): self = .runtimes
    case ("devices", 1): self = .devices
    case ("inbox", 1): self = .inbox
    case ("inbox", 3) where parts[1] == "proposals": self = .proposal(id: parts[2])
    case ("notifications", 1): self = .notifications
    case ("automations", 1): self = .automations
    case ("automations", 2) where parts[1] == "quick": self = .quickRun(runId: nil)
    case ("automations", 4) where parts[1] == "quick" && parts[2] == "runs":
      self = .quickRun(runId: parts[3])
    case ("automations", 2): self = .automation(id: parts[1], runId: nil)
    case ("automations", 4) where parts[2] == "runs": self = .automation(id: parts[1], runId: parts[3])
    case ("sessions", 2): self = .sessionHome(id: parts[1])
    case ("sessions", 3...) where parts[2] == "home": self = .sessionHome(id: parts[1])
    case ("sessions", 3...) where parts[2] == "agents":
      self = .session(id: parts[1], agentId: parts.count > 3 ? parts[3] : nil)
    default: return nil
    }
  }

  /// `argus://sessions/abc/agents` → `/sessions/abc/agents`, as Electron reads it.
  init?(deepLink url: URL) {
    guard url.scheme == "argus" else { return nil }
    self.init(path: "/" + (url.host() ?? "") + url.path())
  }
}
