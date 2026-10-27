import ArgusCore
import Foundation

/// Paths as `docs/routing.md` spells them, for deep links (`argus://…`) and
/// `ARGUS_DEV_ROUTE`, parsed the way Electron's `parseRoute` reads them.
extension DesktopRoute {
  init?(path raw: String) {
    let (path, query) = Self.split(raw)
    let parts = path.split(separator: "/").map { $0.removingPercentEncoding ?? String($0) }
    switch (parts.first, parts.count) {
    case (nil, _): self = .home
    case ("agents", 1): self = .agents
    case ("runtimes", 1): self = .runtimes
    case ("devices", 1): self = .devices
    case ("devices", 3): self = .device(platform: parts[1], deviceKey: parts[2])
    case ("inbox", 1): self = .inbox
    case ("inbox", 3) where parts[1] == "proposals": self = .proposal(id: parts[2])
    case ("notifications", 1): self = .notifications
    case ("usage", 1): self = .usage(.limits)
    case ("usage", 2):
      // An unknown tab falls back to limits, as in Electron.
      let tab = UsageTab(rawValue: parts[1]) ?? .limits
      self = .usage(tab, range: tab == .limits ? nil : Self.usageRange(query["range"]))
    case ("pull-requests", 1): self = .pullRequests
    case ("pull-requests", 4):
      guard let number = Int(parts[3]) else { return nil }
      self = .pullRequest(repo: "\(parts[1])/\(parts[2])", number: number)
    case ("automations", 1): self = .automations
    case ("automations", 2) where parts[1] == "quick": self = .quickRun(runId: nil)
    case ("automations", 4) where parts[1] == "quick" && parts[2] == "runs":
      self = .quickRun(runId: parts[3])
    case ("automations", 2): self = .automation(id: parts[1], runId: nil)
    case ("automations", 4) where parts[2] == "runs": self = .automation(id: parts[1], runId: parts[3])
    // A session's home is gone; old links land on its agents.
    case ("sessions", 2): self = .session(id: parts[1], agentId: nil)
    case ("sessions", 3...) where parts[2] == "home": self = .session(id: parts[1], agentId: nil)
    case ("sessions", 3...) where parts[2] == "agents":
      self = .session(id: parts[1], agentId: parts.count > 3 ? parts[3] : nil)
    case ("sessions", 3...) where parts[2] == "git":
      guard let view = GitRoute(segments: Array(parts.dropFirst(3)), query: query) else { return nil }
      self = .sessionGit(id: parts[1], view: view)
    case ("sessions", 3) where parts[2] == "code":
      let path = query["path"].flatMap(\.nonEmpty)
      self = .sessionCode(id: parts[1], path: path, line: path == nil ? nil : query["line"].flatMap { Int($0) })
    default: return nil
    }
  }

  /// `argus://sessions/abc/agents` → `/sessions/abc/agents`, as Electron reads it.
  init?(deepLink url: URL) {
    guard url.scheme == "argus" else { return nil }
    self.init(path: Self.path(ofDeepLink: url))
  }

  static func path(ofDeepLink url: URL) -> String {
    let query = url.query(percentEncoded: true).map { "?\($0)" } ?? ""
    return "/" + (url.host(percentEncoded: true) ?? "") + url.path(percentEncoded: true) + query
  }

  /// The path this route is at, without `?host=`; `init(path:)` reads it back.
  var path: String {
    switch self {
    case .home: "/"
    case .agents: "/agents"
    case .runtimes: "/runtimes"
    case .devices: "/devices"
    case .device(let platform, let key): "/devices/\(Self.encode(platform))/\(Self.encode(key))"
    case .inbox: "/inbox"
    case .proposal(let id): "/inbox/proposals/\(Self.encode(id))"
    case .notifications: "/notifications"
    case .usage(let tab, let range): pattern + Self.query([("range", tab == .limits ? nil : range?.rawValue)])
    case .pullRequests: "/pull-requests"
    case .pullRequest(let repo, let number): "/pull-requests/\(repo)/\(number)"
    case .automations: "/automations"
    case .quickRun(let runId): runId.map { "/automations/quick/runs/\(Self.encode($0))" } ?? "/automations/quick"
    case .automation(let id, let runId):
      "/automations/\(Self.encode(id))" + (runId.map { "/runs/\(Self.encode($0))" } ?? "")
    case .session(let id, let agentId):
      "/sessions/\(Self.encode(id))/agents" + (agentId.map { "/\(Self.encode($0))" } ?? "")
    case .sessionGit(let id, let view): "/sessions/\(Self.encode(id))/git/\(view.pathSuffix)"
    case .sessionCode(let id, let path, let line):
      "/sessions/\(Self.encode(id))/code" + Self.query([("path", path), ("line", path == nil ? nil : line.map(String.init))])
    }
  }

  /// A known range other than the default; anything else reads as the default.
  static func usageRange(_ raw: String?) -> ArgusProtocol.UsageRange? {
    guard let range = raw.map(ArgusProtocol.UsageRange.init(rawValue:)),
      ArgusProtocol.UsageRange.all.contains(range), range != .default
    else { return nil }
    return range
  }

  /// `?a=1&b=2` from the items that have a value; empty when none do.
  static func query(_ items: [(String, String?)]) -> String {
    var components = URLComponents()
    components.queryItems = items.compactMap { name, value in value.map { URLQueryItem(name: name, value: $0) } }
    return components.percentEncodedQuery.map { $0.isEmpty ? "" : "?\($0)" } ?? ""
  }

  static func encode(_ segment: String) -> String {
    var allowed = CharacterSet.urlPathAllowed
    allowed.remove(charactersIn: "/?#&=")
    return segment.addingPercentEncoding(withAllowedCharacters: allowed) ?? segment
  }

  /// The path and its query items; a malformed query reads as none.
  static func split(_ raw: String) -> (path: String, query: [String: String]) {
    let pieces = raw.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
    let path = pieces.first.map(String.init) ?? raw
    guard pieces.count > 1 else { return (path, [:]) }
    var query: [String: String] = [:]
    for item in URLComponents(string: "?" + pieces[1])?.queryItems ?? [] where query[item.name] == nil {
      query[item.name] = item.value ?? ""
    }
    return (path, query)
  }
}

/// A route plus the machine it reads from: `?host=<id>` on any path, as in
/// Electron's router. Nil host is this Mac.
struct DesktopLocation: Hashable {
  var route: DesktopRoute
  var host: HostId?

  init(route: DesktopRoute, host: HostId? = nil) {
    self.route = route
    self.host = host == Hosts.local ? nil : host
  }

  init?(path raw: String) {
    guard let route = DesktopRoute(path: raw) else { return nil }
    let host = DesktopRoute.split(raw).query["host"]
    self.init(route: route, host: host?.isEmpty == false ? host : nil)
  }

  init?(deepLink url: URL) {
    guard url.scheme == "argus" else { return nil }
    self.init(path: DesktopRoute.path(ofDeepLink: url))
  }

  var path: String {
    let base = route.path
    guard let host else { return base }
    let item = "host=\(DesktopRoute.encode(host))"
    return base + (base.contains("?") ? "&" : "?") + item
  }
}

extension GitRoute {
  /// `/git/<segments>?<query>`: the sub-view, a ref name for `branches`/`tags`
  /// (encoded as one segment, or spread over several when a link didn't), and
  /// the query arguments of `compare`, `blame` and `interactive-rebase`.
  /// Bare `/git` is the working copy, as Electron's default sub-view.
  init?(segments: [String], query: [String: String]) {
    let rest = segments.dropFirst().joined(separator: "/")
    let ref = rest.isEmpty ? nil : rest
    switch segments.first {
    case nil, "working": self = .working
    case "branch": self = .branch
    case "history": self = .history
    case "stashes": self = .stashes
    case "reflog": self = .reflog
    case "conflicts": self = .conflicts
    case "branches": self = .branches(ref)
    case "tags": self = ref.map { .tags($0) } ?? .history
    case "submodules": self = .submodules
    case "bisect": self = .bisect
    case "hooks": self = .hooks
    case "compare": self = .compare(left: query["left"] ?? "", right: query["right"] ?? "")
    case "blame": self = .blame(path: query["path"].flatMap(\.nonEmpty), ref: query["ref"].flatMap(\.nonEmpty))
    case "settings": self = .settings
    case "pull-requests": self = .pullRequests
    case "branches-review": self = .branchesReview
    case "interactive-rebase": self = .interactiveRebase(from: query["from"] ?? "")
    default: return nil
    }
  }

  /// What follows `/git/` in a path, query included.
  var pathSuffix: String {
    let query = DesktopRoute.query
    switch self {
    case .branches(let name?): return "branches/\(DesktopRoute.encode(name))"
    case .tags(let name): return "tags/\(DesktopRoute.encode(name))"
    case .compare(let left, let right): return "compare" + query([("left", left), ("right", right)])
    case .blame(let path, let ref): return "blame" + query([("path", path), ("ref", ref)])
    case .interactiveRebase(let from): return "interactive-rebase" + query([("from", from)])
    default: return segment
    }
  }
}

extension String {
  fileprivate var nonEmpty: String? { isEmpty ? nil : self }
}
