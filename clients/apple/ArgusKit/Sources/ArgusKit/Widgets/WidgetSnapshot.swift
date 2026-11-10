import Foundation

/// What the phone's widgets show, one entry per paired computer. The app writes
/// the computer it is connected to; the others keep their last known state, so
/// a glance covers every computer even though only one is connected at a time.
public struct WidgetSnapshot: Codable, Sendable, Equatable {
  public var hosts: [Host]

  public init(hosts: [Host] = []) {
    self.hosts = hosts
  }

  public struct Host: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var name: String
    public var updatedAt: Date
    /// Agents waiting on you, then the ones still running, most recent first.
    public var agents: [Agent]
    public var proposals: [Proposal]
    /// Every proposal waiting, including the ones past `proposals`' cut.
    public var proposalCount: Int
    public var usage: [UsageAccount]

    public init(
      id: String, name: String, updatedAt: Date, agents: [Agent], proposals: [Proposal],
      proposalCount: Int, usage: [UsageAccount]
    ) {
      self.id = id
      self.name = name
      self.updatedAt = updatedAt
      self.agents = agents
      self.proposals = proposals
      self.proposalCount = proposalCount
      self.usage = usage
    }
  }

  public struct Agent: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var title: String
    public var project: String?
    /// Nil while it is just running; "needs approval", "answer needed", "review plan".
    public var attention: String?
    public var activityAt: Date?
    /// `argus://` link to its chat on its own computer.
    public var url: URL

    public var needsYou: Bool { attention != nil }

    public init(id: String, title: String, project: String?, attention: String?, activityAt: Date?, url: URL) {
      self.id = id
      self.title = title
      self.project = project
      self.attention = attention
      self.activityAt = activityAt
      self.url = url
    }
  }

  public struct Proposal: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var title: String
    public var url: URL

    public init(id: String, title: String, url: URL) {
      self.id = id
      self.title = title
      self.url = url
    }
  }

  public struct UsageAccount: Codable, Sendable, Equatable {
    public var label: String
    /// The rolling session window (five hours on every Claude plan).
    public var session: UsageWindow?
    public var weekly: UsageWindow?

    public init(label: String, session: UsageWindow?, weekly: UsageWindow?) {
      self.label = label
      self.session = session
      self.weekly = weekly
    }
  }

  public struct UsageWindow: Codable, Sendable, Equatable {
    /// 0–100.
    public var usedPercent: Double
    public var resetsAt: Date?

    public init(usedPercent: Double, resetsAt: Date?) {
      self.usedPercent = usedPercent
      self.resetsAt = resetsAt
    }
  }
}

// MARK: Reading it

extension WidgetSnapshot {
  /// Agents across every computer, waiting ones first.
  public var agents: [(host: Host, agent: Agent)] {
    hosts.flatMap { host in host.agents.map { (host, $0) } }
      .sorted { lhs, rhs in
        if lhs.agent.needsYou != rhs.agent.needsYou { return lhs.agent.needsYou }
        return (lhs.agent.activityAt ?? .distantPast) > (rhs.agent.activityAt ?? .distantPast)
      }
  }

  public var needsYouCount: Int { hosts.reduce(0) { $0 + $1.agents.count(where: \.needsYou) } }
  public var runningCount: Int { hosts.reduce(0) { $0 + $1.agents.count(where: { !$0.needsYou }) } }
  public var proposalCount: Int { hosts.reduce(0) { $0 + $1.proposalCount } }

  /// Proposals across every computer, in each one's own order.
  public var proposals: [(host: Host, proposal: Proposal)] {
    hosts.flatMap { host in host.proposals.map { (host, $0) } }
  }

  /// Plan usage per Claude account. The same account signed in on two
  /// computers reads once, from whichever wrote last.
  public var usage: [UsageAccount] {
    var seen = Set<String>()
    return hosts.sorted { $0.updatedAt > $1.updatedAt }
      .flatMap(\.usage)
      .filter { seen.insert($0.label).inserted }
  }

  /// The oldest write the widget is showing, for an "updated" line.
  public var updatedAt: Date? { hosts.map(\.updatedAt).min() }

  public var isEmpty: Bool { hosts.isEmpty }
}

// MARK: Writing it

extension WidgetSnapshot {
  /// Replaces one computer's entry and drops computers no longer paired.
  public mutating func upsert(_ host: Host, paired: Set<String>) {
    hosts.removeAll { $0.id == host.id || !paired.contains($0.id) }
    hosts.append(host)
    hosts.sort { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
  }

  public mutating func prune(paired: Set<String>) {
    hosts.removeAll { !paired.contains($0.id) }
  }

  /// A push arrived while the app may not be running. A push carries no
  /// computer, so the agent is found by id wherever it is listed.
  /// Returns whether anything changed.
  @discardableResult
  public mutating func apply(pushKind kind: String, agentId: String?, now: Date = Date()) -> Bool {
    guard let agentId else { return false }
    var changed = false
    for index in hosts.indices {
      guard let row = hosts[index].agents.firstIndex(where: { $0.id == agentId }) else { continue }
      switch kind {
      case "permission":
        hosts[index].agents[row].attention = "needs approval"
        hosts[index].agents[row].activityAt = now
      case "finished", "failed":
        hosts[index].agents.remove(at: row)
      default:
        continue
      }
      changed = true
    }
    return changed
  }
}

/// The snapshot on disk, in the App Group the app and its extensions share.
public enum WidgetSnapshotStore {
  static let key = "argus.widgetSnapshot"

  public static func load(appGroup: String = ArgusSeal.appGroup) -> WidgetSnapshot {
    guard let data = UserDefaults(suiteName: appGroup)?.data(forKey: key),
      let snapshot = try? decoder.decode(WidgetSnapshot.self, from: data)
    else { return WidgetSnapshot() }
    return snapshot
  }

  public static func save(_ snapshot: WidgetSnapshot, appGroup: String = ArgusSeal.appGroup) {
    guard let data = try? encoder.encode(snapshot) else { return }
    UserDefaults(suiteName: appGroup)?.set(data, forKey: key)
  }

  /// Load, change, save. Returns whether `body` changed it.
  @discardableResult
  public static func update(
    appGroup: String = ArgusSeal.appGroup, _ body: (inout WidgetSnapshot) -> Void
  ) -> Bool {
    var snapshot = load(appGroup: appGroup)
    let before = snapshot
    body(&snapshot)
    guard snapshot != before else { return false }
    save(snapshot, appGroup: appGroup)
    return true
  }

  private static let encoder = JSONEncoder()
  private static let decoder = JSONDecoder()
}

/// The widget kinds, shared so the app can reload exactly the ones it changed.
public enum WidgetKind {
  public static let agents = "dev.houwert.argus.agents"
  public static let inbox = "dev.houwert.argus.inbox"
  public static let usage = "dev.houwert.argus.usage"
  public static let quickAgentControl = "dev.houwert.argus.quick-agent"
}

/// `argus://` links the widgets open, tagged so the app can tell them from
/// other links when it counts them.
public enum WidgetLink {
  public static let sourceItem = "src"

  public enum Source: String, Sendable {
    case widget, control
  }

  /// The phone's new-agent composer, on the last active project.
  public static let newAgentPath = "/sessions/new"

  /// `argus:/` + an `ArgusLocation` path, tagged with where it was opened from.
  public static func url(path: String, source: Source = .widget) -> URL {
    var components = URLComponents(string: "argus:/" + path) ?? URLComponents()
    components.queryItems = (components.queryItems ?? []) + [URLQueryItem(name: sourceItem, value: source.rawValue)]
    return components.url ?? URL(string: "argus://")!
  }

  /// Where a link came from, when a widget or control opened it.
  public static func source(of url: URL) -> Source? {
    URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
      .first { $0.name == sourceItem }?.value.flatMap(Source.init(rawValue:))
  }

  /// Whether a link is the new-agent composer, which only the phone has.
  public static func isNewAgent(_ url: URL) -> Bool {
    url.scheme == "argus" && url.host() == "sessions" && url.path() == "/new"
  }
}
