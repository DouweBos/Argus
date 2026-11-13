import ArgusKit
import Foundation

/// How a compare slot is named wherever it shows: its runner, then its model.
extension HostStore {
  /// The runner's name; nil is the computer's default runner, Claude Code.
  public func compareRunnerName(_ runnerId: String?) -> String {
    let id = runnerId ?? "claude-code"
    return runners.first { $0.id == id }?.displayName ?? (runnerId == nil ? "Claude Code" : id)
  }

  /// The model's name as the runner reports it; nil when the runner picks its own.
  public func compareModelName(runnerId: String?, model: String?) -> String? {
    guard let model else { return nil }
    let declared = (runners.first { $0.id == (runnerId ?? "claude-code") }?.models ?? []).map {
      RemoteModelInfo(value: $0.value, displayName: $0.displayName, description: $0.description ?? "")
    }
    let known = declared.isEmpty ? lastKnownModels(runnerId: runnerId) : declared
    return ModelName.label(for: model, in: known) ?? model
  }

  /// "Codex · GPT-5", or the runner alone.
  public func compareSlotTitle(_ slot: RemoteCompareGroup) -> String {
    let runner = compareRunnerName(slot.runnerId)
    guard let model = compareModelName(runnerId: slot.runnerId, model: slot.model) else { return runner }
    return "\(runner) · \(model)"
  }
}

/// A row of a project's session list: a session, or a compare run's header with its slots.
public enum CompareSessionRow: Identifiable, Hashable, Sendable {
  case session(SessionGroup)
  case compare(CompareGroup, slots: [SessionGroup])

  public var id: String {
    switch self {
    case .session(let group): group.id
    case .compare(let run, _): "compare:\(run.id)"
    }
  }

  /// `groups` with each compare run's slots folded under one header where its first slot sat.
  /// Groups known only from their agents keep their place.
  public static func make(_ groups: [SessionGroup]) -> [CompareSessionRow] {
    let byId = Dictionary(groups.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    var runOf: [String: CompareGroup] = [:]
    for case .group(let run) in CompareGroup.split(groups.compactMap(\.session)) {
      for session in run.sessions { runOf[session.id] = run }
    }
    var shown: Set<String> = []
    var rows: [CompareSessionRow] = []
    for group in groups {
      guard let run = runOf[group.id] else {
        rows.append(.session(group))
        continue
      }
      guard shown.insert(run.id).inserted else { continue }
      rows.append(.compare(run, slots: run.sessions.compactMap { byId[$0.id] }))
    }
    return rows
  }
}
