import ArgusKit
import Foundation
import Synchronization

/// Which machine a host-owned id belongs to. `local` is the host this app
/// supervises; a paired host is keyed by the device id it issued us.
public typealias HostId = String

public enum Hosts {
  /// Never issued as a device id (those are uuids), so it can't collide.
  public static let local: HostId = "local"
}

/// Which host owns a given project, session, agent, terminal or device — the
/// routing table behind `HostRouter`, mirroring the desktop's `hostIndex.ts`.
///
/// Entries are learned from what each host says: its list responses, the ids
/// in its events. Two hosts holding a repo at the same path can't be told apart
/// here; the last one to mention it wins.
public final class HostIndex: Sendable {
  public enum Kind: CaseIterable, Sendable {
    case project, session, agent, terminal, device
  }

  private let tables = Mutex<[Kind: [String: HostId]]>([:])
  /// A device can be reachable from more than one host — two hosts on one
  /// Mac, or one phone plugged into both — so it keeps every host that listed it.
  private let devices = Mutex<[String: [HostId]]>([:])
  private let preferredDeviceHost = Mutex<HostId?>(nil)

  public init() {}

  public func remember(_ kind: Kind, _ id: String, host: HostId) {
    guard !id.isEmpty else { return }
    if kind == .device {
      devices.withLock { if !($0[id] ?? []).contains(host) { $0[id, default: []].append(host) } }
      return
    }
    tables.withLock { $0[kind, default: [:]][id] = host }
  }

  public func host(of kind: Kind, _ id: String) -> HostId? {
    if kind == .device {
      // The machine on screen wins even before its device list lands: the
      // runtime panel only offers that machine's devices.
      if let preferred = preferredDeviceHost.withLock({ $0 }) { return preferred }
      return devices.withLock { $0[id]?.first }
    }
    return tables.withLock { $0[kind]?[id] }
  }

  /// The machine whose devices are on screen; device calls go there.
  public func preferDevices(on host: HostId?) {
    preferredDeviceHost.withLock { $0 = host }
  }

  /// Every id of one kind a host owns.
  public func ids(_ kind: Kind, on host: HostId) -> [String] {
    if kind == .device { return devices.withLock { $0.filter { $0.value.contains(host) }.map(\.key) } }
    return tables.withLock { ($0[kind] ?? [:]).filter { $0.value == host }.map(\.key) }
  }

  /// Drop everything a host owned — on forget, so nothing routes to it.
  public func forget(host: HostId) {
    devices.withLock { devices in
      devices = devices.compactMapValues { hosts in
        let kept = hosts.filter { $0 != host }
        return kept.isEmpty ? nil : kept
      }
    }
    tables.withLock { tables in
      for kind in Kind.allCases {
        tables[kind] = tables[kind]?.filter { $0.value != host }
      }
    }
  }

  // MARK: Subjects

  static let sessionKeys = ["sessionId", "session_id"]
  static let agentKeys = ["agentId", "agent_id"]
  static let terminalKeys = ["terminalId", "terminal_id"]
  static let deviceKeys = ["device_id", "deviceId", "deviceKey", "udid", "serial"]
  static let rootKeys = ["repoRoot", "repo_root", "projectRoot", "projectPath", "root"]

  /// The host a call's subject belongs to, in `hostRouting.ts`'s order:
  /// session, agent, terminal, device, repo root, then any id key naming
  /// something of another kind. Nil when it names nothing this index knows.
  public func subject(of params: JSONValue) -> HostId? {
    guard case .object(let object) = params else { return nil }
    let lookups: [([String], Kind)] = [
      (Self.sessionKeys, .session), (Self.agentKeys, .agent), (Self.terminalKeys, .terminal),
      (Self.deviceKeys, .device), (Self.rootKeys, .project),
    ]
    for (keys, kind) in lookups {
      for key in keys {
        if case .string(let id) = object[key], let owner = host(of: kind, id) { return owner }
      }
    }
    // Ids are uuids, and some commands name a terminal by `sessionId`, so any
    // id-shaped key falls back to every table.
    for key in ["id"] + Self.sessionKeys + Self.agentKeys + Self.terminalKeys {
      guard case .string(let id) = object[key] else { continue }
      for kind in [Kind.session, .agent, .terminal] {
        if let owner = host(of: kind, id) { return owner }
      }
    }
    return nil
  }

  /// The host a gateway subscription scope (`<agentId>`, `terminal:<id>`)
  /// belongs to.
  public func subscriptionHost(_ scope: String) -> HostId? {
    if scope.hasPrefix("terminal:") {
      return host(of: .terminal, String(scope.dropFirst("terminal:".count)))
    }
    return host(of: .agent, scope)
  }

  // MARK: Learning

  /// What a bare `id` means in a method's results: `create_terminal` returns a
  /// terminal, `sessions.list` sessions.
  static func idKind(forMethod method: String) -> Kind? {
    let name = method.lowercased()
    if name.contains("terminal") { return .terminal }
    if name.contains("session") || name.contains("scratch_pad") || name.contains("hydrate") {
      return .session
    }
    if name.contains("simulator") || name.contains("android") || name.contains("device") {
      return .device
    }
    return nil
  }

  /// Methods whose responses are too big to be worth walking and name nothing
  /// new — transcripts and images.
  static func skipsLearning(_ method: String) -> Bool {
    ["transcript", "image", "snapshot", "diff", "git_runner", "file"].contains {
      method.contains($0)
    }
  }

  /// Claim every id a host's response mentions.
  public func learn(response: JSONValue, method: String, host: HostId) {
    guard !Self.skipsLearning(method) else { return }
    var budget = 5000
    walk(response, idKind: Self.idKind(forMethod: method), host: host, depth: 0, budget: &budget)
  }

  /// Claim the ids an event mentions: its agent, and the subject of a raw
  /// broadcast's channel and payload.
  public func learn(event: EventEnvelope, host: HostId) {
    if let agentId = event.agentId { remember(.agent, agentId, host: host) }
    guard case .object(let payload) = event.payload else { return }
    if event.event == "ipc" {
      guard case .string(let channel) = payload["channel"] else { return }
      let parts = channel.split(separator: ":", maxSplits: 2).map(String.init)
      if parts.count == 3, parts[0] == "agent" { remember(.agent, parts[2], host: host) }
      if parts.count == 3, parts[0] == "terminal" { remember(.terminal, parts[2], host: host) }
      if case .array(let args) = payload["args"], let first = args.first {
        var budget = 200
        let kind: Kind? = channel.hasPrefix("session:") ? .session : nil
        walk(first, idKind: kind, host: host, depth: 1, budget: &budget)
      }
      return
    }
    var budget = 200
    walk(event.payload, idKind: nil, host: host, depth: 1, budget: &budget)
  }

  private func walk(_ value: JSONValue, idKind: Kind?, host: HostId, depth: Int, budget: inout Int) {
    guard depth < 5, budget > 0 else { return }
    budget -= 1
    switch value {
    case .array(let items):
      for item in items { walk(item, idKind: idKind, host: host, depth: depth + 1, budget: &budget) }
    case .object(let object):
      claim(object, idKind: idKind, host: host)
      for (key, child) in object where Self.descends(key) {
        walk(child, idKind: Self.childKind(key) ?? idKind, host: host, depth: depth + 1, budget: &budget)
      }
    default:
      break
    }
  }

  /// Nested containers worth looking into; message bodies and tool inputs aren't.
  private static func descends(_ key: String) -> Bool {
    !["messages", "content", "input", "tool_input", "output", "events", "args"].contains(key)
  }

  /// A container's key can say what its items are: `{ sessions: […], agents: […] }`.
  private static func childKind(_ key: String) -> Kind? {
    switch key {
    case "sessions", "scratchPads", "scratch_pads", "session": .session
    case "terminals", "terminal": .terminal
    case "devices", "simulators": .device
    case "agents": .agent
    case "projects": .project
    default: nil
    }
  }

  private func claim(_ object: [String: JSONValue], idKind: Kind?, host: HostId) {
    func string(_ keys: [String]) -> String? {
      for key in keys { if case .string(let s) = object[key], !s.isEmpty { return s } }
      return nil
    }
    if let id = string(Self.sessionKeys) { remember(.session, id, host: host) }
    if let id = string(Self.agentKeys) { remember(.agent, id, host: host) }
    if let id = string(Self.terminalKeys) { remember(.terminal, id, host: host) }
    if let root = string(["repoRoot", "repo_root"]) { remember(.project, root, host: host) }
    if let id = string(["udid", "serial", "deviceKey"]) { remember(.device, id, host: host) }
    if idKind == .project, let path = string(["path"]) { remember(.project, path, host: host) }
    guard let idKind, idKind != .project, let id = string(["id"]) else { return }
    remember(idKind, id, host: host)
  }
}
