import ArgusCore
import ArgusUI
import SwiftUI

/// The project's `.argus.json` run commands: one button, and a chevron menu
/// beside it when there are several. Pressing a running one stops it. In the
/// toolbar it's a pill; in the context card a row, which offers adding one when there are none.
struct RunControl: View {
  @Environment(TerminalsStore.self) private var terminals
  @Environment(HostStore.self) private var store
  @Environment(DesktopModel.self) private var model
  let session: RemoteSession
  var inCard = false
  /// Bring the terminal panel up so the run's output is in view.
  let reveal: () -> Void
  /// Icon only, for a toolbar too narrow for the run's title; the title moves to the tooltip.
  var compact = false
  @State private var pending: (title: String, conflicts: [TerminalsStore.Conflict])?

  private var runs: [TerminalsStore.RunCommand] {
    terminals.configByRepo[session.repoRoot]?.run ?? []
  }

  var body: some View {
    Group {
      if inCard { cardRow } else { pills }
    }
    .disabled(session.status != .ready)
    .confirmationDialog(
      "Another runtime is running", isPresented: isConfirming, titleVisibility: .visible
    ) {
      Button("Stop Other & Run", role: .destructive) { stopOthersAndRun() }
      Button("Cancel", role: .cancel) { pending = nil }
    } message: {
      Text(conflictMessage)
    }
  }

  @ViewBuilder private var cardRow: some View {
    if let primary = runs.first(where: { running($0.title) }) ?? runs.first {
      ContextSplitRow {
        MacTelemetry.capture(.contextCardUsed(action: .run))
        toggle(primary.title)
      } row: {
        ContextCardRow(
          icon: running(primary.title) ? "stop.fill" : Icon.play,
          title: running(primary.title) ? "Stop \(primary.title)" : "Run \(primary.title)")
      } menu: {
        if runs.count > 1 {
          ForEach(runs) { run in
            Button { toggle(run.title) } label: { label(run.title) }
          }
          Divider()
        }
        Button("Edit Run Commands…") { model.projectSettingsRepo = session.repoRoot }
      }
      .help(running(primary.title) ? "Stop \(primary.title)" : primary.command)
    } else if session.kind != .scratchPad {
      Button {
        model.projectSettingsRepo = session.repoRoot
      } label: {
        ContextCardRow(icon: Icon.plus, title: "Add run command", muted: true)
      }
      .buttonStyle(ContextRowButtonStyle())
      .help("Add a run command in Project Settings")
    }
  }

  private var pills: some View {
    // Flat items in the toolbar's one capsule, not a split button's bezel inside it.
    Group {
      if let primary = runs.first(where: { running($0.title) }) ?? runs.first {
        Button { toggle(primary.title) } label: { label(primary.title) }
          .buttonStyle(PillItemButtonStyle(iconOnly: compact))
          .labelStyle(compact ? AnyLabelStyle(.iconOnly) : AnyLabelStyle(.titleAndIcon))
          .help(running(primary.title) ? "Stop \(primary.title)" : compact ? primary.title : primary.command)
        if runs.count > 1 {
          Menu {
            ForEach(runs) { run in
              Button { toggle(run.title) } label: { label(run.title) }
            }
          } label: {
            Label("Run Commands", systemImage: "chevron.down")
          }
          .menuStyle(.button)
          .menuIndicator(.hidden)
          .help("Run commands")
          // A toolbar menu keeps the items it was first built with.
          .id(runs.map { running($0.title) })
        }
      }
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

/// `labelStyle` wants one static type; the run control switches at run time.
private struct AnyLabelStyle: LabelStyle {
  private let make: (Configuration) -> AnyView

  init(_ style: some LabelStyle) {
    make = { AnyView(style.makeBody(configuration: $0)) }
  }

  func makeBody(configuration: Configuration) -> some View {
    make(configuration)
  }
}
