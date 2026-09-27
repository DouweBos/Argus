import ArgusKit
import SwiftUI

/// One automation: what it is, when it next fires, and every time it has run.
///
/// Run now is the only thing this screen changes, and it needs control —
/// firing one starts an agent on the computer. Without the grant the button is
/// absent rather than disabled, because a monitor device is never going to get
/// it by tapping.
struct AutomationView: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
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
        memories
        runs(automation)
      } else {
        Loading(label: "Reading the automation…")
      }
    }
    .navigationTitle(automation?.name ?? label)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if app.hasControl {
        ToolbarItem(placement: .topBarTrailing) {
          NavigationLink(
            value: Route.automationEditor(id: automationId, label: automation?.name ?? label)
          ) {
            Label("Edit", systemImage: Icon.pencil)
          }
        }
      }
    }
    .liveRefresh(enabled: app.connection == .ready) {
      await store.refresh()
      await store.loadMemories(automationId: automationId)
    }
    .sheet(item: $openMemory) { selection in
      MemoryEditorSheet(automationId: automationId, memory: selection.memory)
    }
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
    if app.hasControl {
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
        if app.hasControl {
          // The one dial worth flipping without opening the editor.
          Toggle("", isOn: Binding(
            get: { automation.enabled },
            set: { enabled in
              Task { await store.setEnabled(id: automationId, enabled: enabled) }
            }))
            .labelsHidden()
            .tint(theme.accent)
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

      if app.hasControl {
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
          .disabled(triggering || app.connection != .ready)
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
        body: app.hasControl
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
