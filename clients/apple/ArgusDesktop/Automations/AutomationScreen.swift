import ArgusCore
import ArgusUI
import SwiftUI

/// `/automations/:automationId` — what it does, its track record and memories,
/// and every time it has run — or, with a run id, that one run.
struct AutomationScreen: View {
  let automationId: String; let runId: String?

  var body: some View {
    if let runId {
      RunScreen(runId: runId, automationId: automationId).id(runId)
    } else {
      AutomationDetail(automationId: automationId)
    }
  }
}

private struct AutomationDetail: View {
  @Environment(DesktopModel.self) private var model
  @Environment(AutomationsStore.self) private var store
  let automationId: String

  @State private var draft = RemoteAutomationDetail()
  /// What the host holds, so Save only lights up on a real change.
  @State private var saved: RemoteAutomationDetail?
  @State private var saving = false
  @State private var confirmingDelete = false

  private var automation: RemoteAutomation? {
    store.automations.first { $0.id == automationId }
  }

  var body: some View {
    Group {
      if let automation {
        form(automation)
      } else if store.loaded {
        EmptyState(
          icon: "clock.badge.questionmark", title: "Automation not found",
          body: "It may have been deleted on this host."
        ) {
          Button("Back to Automations") { model.navigate(.automations) }
        }
      } else {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .navigationTitle(automation?.name ?? "Automation")
    .navigationSubtitle(automation.map { "\(Labels.triggerLabel($0)) · next \(AutomationText.nextRun($0))" } ?? "")
    .toolbar { if let automation { toolbar(automation) } }
    .confirmationDialog("Delete this automation?", isPresented: $confirmingDelete) {
      Button("Delete Automation", role: .destructive) { delete() }
    } message: {
      Text("Its schedule stops and it disappears from the list.")
    }
    .task {
      await store.loadSources()
      await store.loadRunners()
      if let detail = await store.loadDetail(id: automationId) {
        draft = detail
        saved = detail
      }
    }
    .task(id: store.runs(for: automationId).count) {
      await store.loadCalibration(automationId: automationId)
    }
  }

  private func form(_ automation: RemoteAutomation) -> some View {
    Form {
      if let error = store.error {
        Section { Banner(text: error, tone: .danger) }
      }
      TrackRecordSection(calibration: store.calibrationById[automationId])
      if saved != nil {
        AutomationEditorForm(draft: $draft)
      } else {
        Section("Configuration") { ProgressView() }
      }
      MemoriesSection(automationId: automationId)
      runHistory
    }
    .formStyle(.grouped)
  }

  private var runHistory: some View {
    let runs = store.runs(for: automationId)
    return Section {
      if runs.isEmpty {
        Text("This automation has never run. Press Run now to see what it does.")
          .foregroundStyle(.secondary)
      }
      ForEach(runs) { run in
        RunHistoryRow(run: run, title: run.triggerReason) {
          model.navigate(.automation(id: automationId, runId: run.id))
        }
      }
    } header: {
      HStack {
        Text("Run history")
        Spacer()
        Text(AutomationText.plural(runs.count, "run")).foregroundStyle(.secondary)
      }
    }
  }

  @ToolbarContentBuilder
  private func toolbar(_ automation: RemoteAutomation) -> some ToolbarContent {
    ToolbarItemGroup {
      Toggle(
        automation.enabled ? "Enabled" : "Paused",
        isOn: Binding(
          get: { automation.enabled },
          set: { on in
            draft.enabled = on
            saved?.enabled = on
            Task { await store.setEnabled(id: automationId, enabled: on) }
          })
      )
      .toggleStyle(.switch)
      AutomationRunButton(automationId: automationId)
      Button("Delete") { confirmingDelete = true }
      Button(saving ? "Saving…" : saved == draft ? "Saved" : "Save Changes") { save() }
        .keyboardShortcut("s", modifiers: .command)
        .disabled(saving || saved == nil || saved == draft || !canSave)
    }
  }

  private var canSave: Bool {
    !draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && !draft.playbook.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && draft.hasValidTrigger
  }

  private func save() {
    saving = true
    Task {
      if await store.save(id: automationId, input: RemoteAutomationInput(draft)) != nil,
        let detail = store.detailById[automationId]
      {
        draft = detail
        saved = detail
      }
      saving = false
    }
  }

  private func delete() {
    Task {
      guard await store.delete(id: automationId) else { return }
      model.navigate(.automations)
    }
  }
}

/// The track record, stated plainly: an automation that is wrong seven times
/// out of ten should read as wrong here.
private struct TrackRecordSection: View {
  @Environment(\.theme) private var theme
  let calibration: ArgusProtocol.AutomationCalibration?

  var body: some View {
    if let calibration, calibration.sample > 0 {
      Section {
        HStack(alignment: .top, spacing: 24) {
          stat(
            "Acceptance", calibration.acceptanceRate.map { "\(Int(($0 * 100).rounded()))%" } ?? "—",
            "\(Int(calibration.accepted + calibration.autoStarted + calibration.resolved)) kept · "
              + "\(Int(calibration.dismissed)) dismissed",
            poor: (calibration.acceptanceRate ?? 1) < 0.5)
          stat("Auto-started", "\(Int(calibration.autoStarted))")
          stat("Waiting", "\(Int(calibration.pending))")
          stat("Merged", "\(Int(calibration.merged))", "\(Int(calibration.abandoned)) abandoned")
        }
        ForEach(Array(calibration.dismissals.enumerated()), id: \.offset) { _, dismissal in
          Label("\(dismissal.title) — \(dismissal.reason)", systemImage: "exclamationmark.triangle")
            .foregroundStyle(theme.warning)
        }
      } header: {
        HStack {
          Text("Track record")
          Spacer()
          Text("last \(AutomationText.plural(Int(calibration.sample), "proposal"))")
            .foregroundStyle(.secondary)
        }
      }
    }
  }

  private func stat(_ label: String, _ value: String, _ delta: String? = nil, poor: Bool = false)
    -> some View
  {
    VStack(alignment: .leading, spacing: 2) {
      Text(label).font(.scaled(.caption)).foregroundStyle(.secondary)
      Text(value).font(.scaled(.title3).weight(.semibold)).monospacedDigit()
      if let delta {
        Text(delta).font(.scaled(.caption)).foregroundStyle(poor ? theme.error : theme.textSecondary)
      }
    }
  }
}
