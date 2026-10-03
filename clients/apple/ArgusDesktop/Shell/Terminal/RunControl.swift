import ArgusCore
import SwiftUI

/// The project's `.argus.json` run commands, in the toolbar: one button, or a
/// split button when there are several. Pressing a running one stops it.
struct RunControl: View {
  @Environment(TerminalsStore.self) private var terminals
  @Environment(HostStore.self) private var store
  let session: RemoteSession
  /// Bring the terminal panel up so the run's output is in view.
  let reveal: () -> Void
  @State private var pending: (title: String, conflicts: [TerminalsStore.Conflict])?

  private var runs: [TerminalsStore.RunCommand] {
    terminals.configByRepo[session.repoRoot]?.run ?? []
  }

  var body: some View {
    Group {
      if runs.count == 1, let only = runs.first {
        Button { toggle(only.title) } label: { label(only.title) }
          .help(running(only.title) ? "Stop \(only.title)" : only.command)
      } else if let primary = runs.first(where: { running($0.title) }) ?? runs.first {
        Menu {
          ForEach(runs) { run in
            Button { toggle(run.title) } label: { label(run.title) }
          }
        } label: {
          label(primary.title)
        } primaryAction: {
          toggle(primary.title)
        }
        .help(running(primary.title) ? "Stop \(primary.title)" : primary.command)
      }
    }
    .labelStyle(.titleAndIcon)
    .disabled(session.status != .ready)
    .task(id: session.repoRoot) {
      await terminals.loadConfig(repoRoot: session.repoRoot)
      await terminals.refresh(sessionId: session.id)
    }
    .confirmationDialog(
      "Another runtime is running", isPresented: isConfirming, titleVisibility: .visible
    ) {
      Button("Stop Other & Run", role: .destructive) { stopOthersAndRun() }
      Button("Cancel", role: .cancel) { pending = nil }
    } message: {
      Text(conflictMessage)
    }
  }

  private func label(_ title: String) -> some View {
    running(title)
      ? Label("Stop \(title)", systemImage: "stop.fill")
      : Label(title, systemImage: "play.fill")
  }

  private func running(_ title: String) -> Bool {
    terminals.running(title, in: session.id) != nil
  }

  private func toggle(_ title: String) {
    if let tab = terminals.running(title, in: session.id) {
      MacTelemetry.capture(.terminalUsed(action: .stop))
      Task { await terminals.stop(tab.id) }
      return
    }
    if terminals.configByRepo[session.repoRoot]?.singleRuntime == true {
      let siblings = Set((store.sessionsByRepo[session.repoRoot] ?? []).map(\.id))
      let conflicts = terminals.conflicts(for: session.id, sessionsInRepo: siblings)
      if !conflicts.isEmpty {
        pending = (title, conflicts)
        return
      }
    }
    MacTelemetry.capture(.terminalUsed(action: .run))
    start(title)
  }

  private func start(_ title: String) {
    reveal()
    Task { await terminals.run(title, sessionId: session.id) }
  }

  /// Wait for the old run to exit before starting: it may still hold the port.
  private func stopOthersAndRun() {
    guard let pending else { return }
    self.pending = nil
    MacTelemetry.capture(.terminalUsed(action: .stopOthersAndRun))
    Task {
      await terminals.stopAndWait(pending.conflicts.map(\.terminalId))
      start(pending.title)
    }
  }

  private var isConfirming: Binding<Bool> {
    Binding(get: { pending != nil }, set: { if !$0 { pending = nil } })
  }

  private var conflictMessage: String {
    guard let pending else { return "" }
    let names = pending.conflicts.map { conflict in
      let session = store.sessionsByRepo[self.session.repoRoot]?.first { $0.id == conflict.sessionId }
      return "\(conflict.title) in \(session?.displayName ?? session?.branch ?? "another session")"
    }
    return "This project allows one runtime at a time. Still running: \(names.joined(separator: ", ")). Stop \(names.count == 1 ? "it" : "them") and start \(pending.title) here?"
  }
}
