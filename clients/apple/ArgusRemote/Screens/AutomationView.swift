import ArgusUI
import SwiftUI

/// One automation: what it is, when it next fires, and every time it has run.
///
/// Run now is the only thing this screen changes, and it needs control —
/// firing one starts an agent on the computer. Without the grant the button is
/// absent rather than disabled, because a monitor device is never going to get
/// it by tapping.
struct AutomationView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(AutomationsStore.self) private var store

  let automationId: String
  let label: String

  /// The memory sheet: `.some(nil)` adds one, `nil` is closed.
  @State private var openMemory: MemorySelection?

  private struct MemorySelection: Identifiable {
    let memory: RemoteAutomationMemory?
    var id: String { memory?.name ?? "+new" }
  }

  private var automation: RemoteAutomation? {
    store.automations.first { $0.id == automationId }
  }

  var body: some View {
    Screen {
      if let error = store.error {
        Banner(text: error, tone: .danger)
      }
      if let automation {
        detail(automation)
        trackRecord
        memories
        runs(automation)
      } else {
        Loading(label: "Reading the automation…")
      }
    }
    .navigationTitle(automation?.name ?? label)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if host.hasControl {
        ToolbarItem(placement: .topBarTrailing) {
          NavigationLink(
            value: Route.automationEditor(id: automationId, label: automation?.name ?? label)
          ) {
            Label("Edit", systemImage: Icon.pencil)
          }
        }
      }
    }
    .liveRefresh(enabled: host.connection == .ready) {
      await store.refresh()
      await store.loadMemories(automationId: automationId)
      await store.loadCalibrationOverGateway(automationId: automationId)
    }
    .sheet(item: $openMemory) { selection in
      MemoryEditorSheet(automationId: automationId, memory: selection.memory)
    }
  }

  /// How often its proposals were kept versus dismissed — the record that
  /// says whether to trust it with more autonomy.
  @ViewBuilder
  private var trackRecord: some View {
    if let record = store.calibrationById[automationId], record.sample > 0 {
      SectionHeader(title: "Track record", count: Int(record.sample))
      Card {
        if let rate = record.acceptanceRate {
          BodyText("\(Int((rate * 100).rounded()))% kept")
        } else {
          BodyText("Nothing decided yet")
        }
        MutedText(Self.recordSummary(record), lineLimit: 3)
        ForEach(Array(record.dismissals.prefix(3).enumerated()), id: \.offset) { _, dismissal in
          MutedText("Dismissed “\(dismissal.title)”: \(dismissal.reason)", lineLimit: 2)
        }
      }
    }
  }

  static func recordSummary(_ record: ArgusProtocol.AutomationCalibration) -> String {
    let parts: [(Double, String)] = [
      (record.accepted, "started"), (record.autoStarted, "auto-started"),
      (record.resolved, "done by you"), (record.dismissed, "dismissed"),
      (record.pending, "waiting"), (record.superseded, "replaced"),
      (record.withdrawn, "withdrawn"),
    ]
    return parts.filter { $0.0 > 0 }.map { "\(Int($0.0)) \($0.1)" }.joined(separator: " · ")
  }

  @ViewBuilder
  private var memories: some View {
    let items = store.memoriesById[automationId] ?? []
    SectionHeader(title: "Memories", count: items.count)
    if items.isEmpty {
      MutedText("Nothing yet. Runs save what they learn here so the next one doesn't start from scratch.")
    }
    ForEach(items) { memory in
      Card(onTap: { openMemory = MemorySelection(memory: memory) }) {
        HStack(spacing: 8) {
          Text(memory.name)
            .font(.system(size: 13, weight: .semibold, design: .monospaced))
            .foregroundStyle(theme.text)
          Spacer(minLength: 6)
          Badge(label: memory.type.rawValue)
        }
        MutedText(memory.description, lineLimit: 2)
      }
    }
    if host.hasControl {
      Btn(label: "Add memory", tone: .secondary, small: true, icon: Icon.plus) {
        openMemory = MemorySelection(memory: nil)
      }
    }
  }

  @ViewBuilder
  private func detail(_ automation: RemoteAutomation) -> some View {
    Card {
      HStack(spacing: 8) {
        Image(systemName: Icon.clock)
          .font(.system(size: 13))
          .foregroundStyle(theme.textSecondary)
        BodyText(Labels.triggerLabel(automation))
        Spacer(minLength: 6)
        if host.hasControl {
          // The one dial worth flipping without opening the editor.
          Toggle("", isOn: Binding(
            get: { automation.enabled },
            set: { enabled in
              Task { await store.setEnabled(id: automationId, enabled: enabled) }
            }))
            .labelsHidden()
            .toggleStyle(.argusSwitch)
        } else {
          Badge(
            label: automation.enabled ? "Enabled" : "Paused",
            tone: automation.enabled ? .success : .muted)
        }
      }
      if !automation.description.isEmpty {
        MutedText(automation.description)
      }
      HStack(spacing: 10) {
        if automation.enabled, let next = Labels.until(automation.nextRunAt) {
          MutedText("Next run \(next)")
        }
        if let autonomy = automation.autonomy {
          MutedText("Autonomy: \(autonomy.label)")
        }
      }
      if !automation.projects.isEmpty {
        MutedText("Projects: \(automation.projects.joined(separator: ", "))", lineLimit: 2)
      }

      if host.hasControl {
        if let active = store.runs(for: automationId).first(where: \.isActive) {
          Btn(label: "Cancel run", tone: .danger, small: true) {
            Task { await store.cancelRun(id: active.id) }
          }
        } else {
          let triggering = store.triggering.contains(automationId)
          Btn(
            label: triggering ? "Starting…" : "Run now", small: true, icon: Icon.play
          ) {
            Task { await store.runNow(automationId: automationId) }
          }
          .disabled(triggering || host.connection != .ready)
        }
      }
    }
  }

  @ViewBuilder
  private func runs(_ automation: RemoteAutomation) -> some View {
    let items = store.runs(for: automationId)
    if items.isEmpty {
      EmptyState(
        icon: Icon.history,
        title: "Never run",
        body: host.hasControl
          ? "Press Run now to see what it does."
          : "This device can watch automations but not start them.")
    } else {
      SectionHeader(title: "Runs", count: items.count)
      ForEach(items) { run in
        NavigationLink(value: Route.run(id: run.id, label: automation.name)) {
          RunRow(run: run)
        }
      }
    }
  }
}
