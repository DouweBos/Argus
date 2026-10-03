import ArgusCore
import ArgusUI
import SwiftUI

/// `/automations`: every automation on this host — trigger, last and next
/// run, the enable switch and Run now.
struct AutomationsScreen: View {
  @Environment(DesktopModel.self) private var model
  @Environment(AutomationsStore.self) private var store
  @State private var selection: String?
  @State private var describing = false
  @State private var creating = false

  private var quickRuns: Int { store.runs.count { $0.isQuick } }

  var body: some View {
    Group {
      if store.automations.isEmpty {
        if store.loaded { empty } else { ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity) }
      } else {
        table
      }
    }
    .safeAreaInset(edge: .top) {
      if let error = store.error { Banner(text: error, tone: .danger).padding([.horizontal, .top]) }
    }
    .navigationTitle("Automations")
    .navigationSubtitle(AutomationText.plural(store.automations.count, "automation"))
    .toolbar { toolbar }
    .sheet(isPresented: $describing) { DescribeAutomationSheet() }
    .task { await store.refresh() }
  }

  @ToolbarContentBuilder
  private var toolbar: some ToolbarContent {
    ToolbarItemGroup {
      Button {
        model.navigate(.quickRun(runId: nil))
      } label: {
        Label(quickRuns > 0 ? "Quick Run (\(quickRuns))" : "Quick Run", systemImage: "bolt")
      }
      .labelStyle(.titleAndIcon)
      Button { describing = true } label: { Label("Describe It…", systemImage: "sparkles") }
        .labelStyle(.titleAndIcon)
      Button { create() } label: { Label("New Automation", systemImage: "plus") }
        .disabled(creating)
    }
  }

  private var empty: some View {
    ContentUnavailableView {
      Label("No automations yet", systemImage: "clock")
    } description: {
      Text(
        "An automation is a playbook plus a clock: it wakes an agent up on a schedule, or when "
          + "you press Run. To run something once without saving it, use a quick run.")
    } actions: {
      Button("Describe It…") { describing = true }
      Button("New Automation") { create() }.disabled(creating)
    }
  }

  private var table: some View {
    Table(store.automations, selection: $selection) {
      TableColumn("") { automation in
        Toggle(
          "",
          isOn: Binding(
            get: { automation.enabled },
            set: { on in Task { await store.setEnabled(id: automation.id, enabled: on) } })
        )
        .toggleStyle(.switch).controlSize(.mini).labelsHidden()
        .help(automation.enabled ? "Enabled" : "Paused")
      }
      .width(44)
      TableColumn("Name") { automation in
        Button { model.navigate(.automation(id: automation.id, runId: nil)) } label: {
          VStack(alignment: .leading, spacing: 2) {
            Text(automation.name).fontWeight(.medium)
            if !automation.description.isEmpty {
              Text(automation.description).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
          }
          .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(automation.name)
      }
      TableColumn("Trigger") { Text(Labels.triggerLabel($0)) }
      TableColumn("Last run") { LastRunCell(automationId: $0.id) }.width(min: 150)
      TableColumn("Next run") { Text(AutomationText.nextRun($0)).foregroundStyle(.secondary) }
      TableColumn("") { AutomationRunButton(automationId: $0.id) }.width(90)
    }
    .contextMenu(forSelectionType: String.self) { ids in
      if let id = ids.first {
        Button("Open") { model.navigate(.automation(id: id, runId: nil)) }
        Button("Run Now") { Task { await store.runNow(automationId: id) } }
      }
    } primaryAction: { ids in
      if let id = ids.first { model.navigate(.automation(id: id, runId: nil)) }
    }
  }

  private func create() {
    creating = true
    Task {
      await AutomationActions.createNew(model)
      creating = false
    }
  }
}

private struct LastRunCell: View {
  @Environment(AutomationsStore.self) private var store
  let automationId: String

  var body: some View {
    if let latest = store.runs(for: automationId).first {
      HStack(spacing: 6) {
        Badge(label: latest.status.rawValue, tone: latest.status.tone).fixedSize()
        Text(Labels.timeAgo(latest.startedAt)).foregroundStyle(.secondary)
      }
    } else {
      Text("Never").foregroundStyle(.secondary)
    }
  }
}

/// Run now, or Cancel while a run is in flight — a second trigger would only
/// be recorded as a skipped run.
struct AutomationRunButton: View {
  @Environment(AutomationsStore.self) private var store
  let automationId: String

  var body: some View {
    if let active = store.runs(for: automationId).first(where: \.isActive) {
      Button("Cancel") { Task { await store.cancelRun(id: active.id) } }
    } else {
      let starting = store.triggering.contains(automationId)
      Button(starting ? "Starting…" : "Run Now") {
        Task { await store.runNow(automationId: automationId) }
      }
      .disabled(starting)
    }
  }
}
