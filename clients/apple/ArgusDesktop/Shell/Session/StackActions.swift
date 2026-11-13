import ArgusCore
import ArgusUI
import SwiftUI

/// Restack and Land Stack, shared by the sidebar's menu and the context card.
/// A conflict opens the resolver in the session it stopped in.
@MainActor
struct StackActions {
  let model: DesktopModel
  let store: HostStore

  func members(of session: RemoteSession) -> [RemoteSession] {
    SessionStack.members(of: session.id, in: store.sessionsByRepo[session.repoRoot] ?? [])
  }

  private func rootId(of session: RemoteSession) -> String {
    members(of: session).first?.id ?? session.id
  }

  func restack(_ session: RemoteSession) async {
    let root = rootId(of: session)
    model.stackNotes[root] = "Restacking…"
    guard let result = await store.restack(sessionId: session.id) else {
      model.stackNotes[root] = nil
      return
    }
    if let conflict = result.conflict {
      model.stackNotes[root] = "Stopped on a conflict in \(name(conflict.session_id)). Resolve it, then restack again."
      model.navigate(.sessionGit(id: conflict.session_id, view: .conflicts))
      return
    }
    model.stackNotes[root] = Self.restackSummary(result)
  }

  func land(_ session: RemoteSession) async {
    let count = members(of: session).count
    guard
      let choice = await GitDialogs.choose(
        "Land all \(count) sessions?",
        message: "Each one merges into the next one's base, bottom first: its pull request when it has one, otherwise locally. A conflict or a blocked pull request stops it.",
        buttons: [HostStore.MergeStrategy.keep.label, HostStore.MergeStrategy.squash.label])
    else { return }
    let root = rootId(of: session)
    model.stackNotes[root] = "Landing…"
    guard let result = await store.landStack(sessionId: session.id, strategy: choice == 0 ? .keep : .squash) else {
      model.stackNotes[root] = nil
      return
    }
    let landed = result.landed.count == 1 ? "Landed 1 session" : "Landed \(result.landed.count) sessions"
    guard let stopped = result.stopped else {
      model.stackNotes[root] = "\(landed)."
      return
    }
    // The bottom that's left is whichever stopped; its note goes with it.
    model.stackNotes[root] = nil
    model.stackNotes[stopped.session_id] = "\(landed), then stopped at \(name(stopped.session_id)): \(stopped.reason)"
    if stopped.files != nil {
      model.navigate(.sessionGit(id: stopped.session_id, view: .conflicts))
    }
  }

  private func name(_ id: String) -> String {
    let session = store.sessionsByRepo.values.lazy.flatMap { $0 }.first { $0.id == id }
    return session.map { $0.displayName ?? $0.branch } ?? "a session"
  }

  static func restackSummary(_ result: HostStore.RestackResult) -> String {
    let moved = result.restacked.count
    var text = moved == 0 ? "Already up to date." : "Restacked \(moved) session\(moved == 1 ? "" : "s")."
    if !result.pushed.isEmpty {
      text += " Pushed \(result.pushed.count) pull request\(result.pushed.count == 1 ? "" : "s")."
    }
    return text
  }
}
