import ArgusCore
import SwiftUI

/// A session's place in its stack, with Restack, Land stack and starting a
/// session on top of it. The phone's twin of the Mac context card's stack rows.
public struct StackCard: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host

  let sessionId: String
  /// The app opens its own sheet, so it can count where new sessions start from.
  let onNewSessionOnTop: () -> Void
  let onChanged: () async -> Void

  @State private var busy: String?
  @State private var note: String?
  @State private var confirmingLand = false

  public init(sessionId: String, onNewSessionOnTop: @escaping () -> Void, onChanged: @escaping () async -> Void) {
    self.sessionId = sessionId
    self.onNewSessionOnTop = onNewSessionOnTop
    self.onChanged = onChanged
  }

  private var session: RemoteSession? {
    host.sessionsByRepo.values.lazy.flatMap { $0 }.first { $0.id == sessionId }
  }
  private var members: [RemoteSession] {
    guard let session else { return [] }
    return SessionStack.members(of: sessionId, in: host.sessionsByRepo[session.repoRoot] ?? [])
  }

  public var body: some View {
    if let session, session.kind == .worktree, session.status == .ready, session.compareGroup == nil,
      !host.mergedSessionIds.contains(sessionId)
    {
      Card {
        SectionHeader(title: "Stack")
        if members.isEmpty {
          MutedText("Start a session that branches from \(session.branch). Its pull request targets this branch.")
        } else {
          ForEach(Array(members.enumerated()), id: \.element.id) { index, member in
            HStack(spacing: 6) {
              Image(systemName: index == 0 ? Icon.branch : Icon.stacked)
                .font(.scaled(size: 11))
                .foregroundStyle(theme.textMuted)
                .padding(.leading, CGFloat(max(index - 1, 0)) * 10)
              BodyText(member.displayName ?? member.branch, lineLimit: 1)
                .fontWeight(member.id == sessionId ? .semibold : .regular)
            }
          }
        }
        if let note { MutedText(note, lineLimit: 3) }
        Divider().overlay(theme.border).padding(.vertical, 2)
        ViewThatFits(in: .horizontal) {
          HStack(spacing: 8) { buttons(hugs: true) }
          VStack(spacing: 8) { buttons(hugs: false) }
        }
      }
      .confirmationDialog(
        "Land all \(members.count) sessions?", isPresented: $confirmingLand, titleVisibility: .visible
      ) {
        Button(HostStore.MergeStrategy.keep.label) { land(.keep) }
        Button(HostStore.MergeStrategy.squash.label) { land(.squash) }
        Button("Cancel", role: .cancel) {}
      } message: {
        Text("Bottom first, each one merges into its base: its pull request when it has one, otherwise on the computer. A conflict or a blocked pull request stops it.")
      }
    }
  }

  @ViewBuilder private func buttons(hugs: Bool) -> some View {
    if !members.isEmpty {
      Btn(label: busy == "restack" ? "Restacking…" : "Restack", tone: .secondary, small: true, icon: Icon.restack, hugs: hugs) {
        restack()
      }
      .disabled(busy != nil)
      Btn(label: busy == "land" ? "Landing…" : "Land stack", tone: .secondary, small: true, icon: Icon.landStack, hugs: hugs) {
        confirmingLand = true
      }
      .disabled(busy != nil)
    }
    Btn(label: "New session on top", tone: .secondary, small: true, icon: Icon.plus, hugs: hugs) {
      onNewSessionOnTop()
    }
    .disabled(busy != nil)
  }

  private func name(_ id: String) -> String {
    members.first { $0.id == id }.map { $0.displayName ?? $0.branch } ?? "a session"
  }

  private func restack() {
    busy = "restack"
    Task {
      defer { busy = nil }
      guard let result = await host.restack(sessionId: sessionId) else { return }
      if let conflict = result.conflict {
        note = "Stopped on a conflict in \(name(conflict.session_id)) (\(conflict.files.joined(separator: ", "))). Resolve it on the computer, then restack again."
      } else {
        let moved = result.restacked.count
        note = moved == 0 ? "Already up to date." : "Restacked \(moved) session\(moved == 1 ? "" : "s")."
        if !result.pushed.isEmpty { note! += " Pushed \(result.pushed.count) pull request\(result.pushed.count == 1 ? "" : "s")." }
      }
      await onChanged()
    }
  }

  private func land(_ strategy: HostStore.MergeStrategy) {
    busy = "land"
    Task {
      defer { busy = nil }
      guard let result = await host.landStack(sessionId: sessionId, strategy: strategy) else { return }
      let landed = "Landed \(result.landed.count) session\(result.landed.count == 1 ? "" : "s")"
      if let stopped = result.stopped {
        note = "\(landed), then stopped at \(name(stopped.session_id)): \(stopped.reason)"
      } else {
        note = "\(landed)."
      }
      await onChanged()
    }
  }
}

/// Name a session to stack on another; the computer branches it from that session's branch.
public struct StackedSessionSheet: View {
  @Environment(HostStore.self) private var host
  @Environment(\.dismiss) private var dismiss

  let parent: RemoteSession
  let onCreated: (RemoteSession) -> Void

  @State private var description = ""
  @State private var prompt = ""
  @State private var creating = false

  public init(parent: RemoteSession, onCreated: @escaping (RemoteSession) -> Void) {
    self.parent = parent
    self.onCreated = onCreated
  }

  public var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("What should it do?", text: $description, axis: .vertical).lineLimit(2...6)
        } footer: {
          Text("Stacked on \(parent.displayName ?? parent.branch): branches from \(parent.branch), and its pull request targets that branch.")
        }
        Section {
          TextField("First prompt (optional)", text: $prompt, axis: .vertical).lineLimit(3...10)
        } footer: {
          Text("An agent starts with this once the worktree is ready.")
        }
      }
      .sheetTitle("New session on top")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Create") { create() }
            .disabled(creating || description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
      }
    }
  }

  private func create() {
    creating = true
    let prompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
    Task {
      let session = await host.createSession(
        repoRoot: parent.repoRoot, branch: "",
        description: description.trimmingCharacters(in: .whitespacesAndNewlines),
        parentSessionId: parent.id, prompt: prompt.isEmpty ? nil : prompt)
      creating = false
      guard let session else { return }
      onCreated(session)
      dismiss()
    }
  }
}
