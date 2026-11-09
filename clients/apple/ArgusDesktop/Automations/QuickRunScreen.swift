import ArgusCore
import ArgusUI
import SwiftUI

/// `/automations/quick` — a playbook run once against the projects you pick,
/// with nothing saved; or, with a run id, that one ad-hoc run.
struct QuickRunScreen: View {
  let runId: String?

  var body: some View {
    if let runId {
      RunScreen(runId: runId, automationId: nil).id(runId)
    } else {
      QuickRunComposer()
    }
  }
}

/// The same runner, host session and ladder as a scheduled run. Autonomy isn't
/// offered: an ad-hoc run inherits the app default, floored by each project.
private struct QuickRunComposer: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var host
  @Environment(AutomationsStore.self) private var store

  @State private var name = ""
  @State private var playbook = ""
  @State private var repoRoots: [String] = []
  @State private var sourceIds: [String] = []
  @State private var starting = false
  @State private var runLater = false
  @State private var runAt = OnceTime.date(OnceTime.nextWholeHour(timezone: nil), timezone: nil) ?? Date()

  private var runs: [RemoteAutomationRun] { store.runs.filter(\.isQuick) }
  private var canRun: Bool { !starting && !playbook.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

  var body: some View {
    Form {
      if let error = store.error { Section { Banner(text: error, tone: .danger) } }
      Section {
        TextField("Name", text: $name, prompt: Text("Quick run"))
        PlaybookEditor(text: $playbook, placeholder: "Summarise what landed on each project this week.")
      } header: {
        Text("Playbook")
      } footer: {
        Text(
          "Markdown instructions handed to the run's agent. Nothing is saved — you can turn the run "
            + "into an automation afterwards.")
      }
      ProjectScopeSection(
        selection: $repoRoots, footer: "Repos the run may read, at their own paths. It never writes to them.")
      SourceScopeSection(selection: $sourceIds)
      Section {
        Toggle("Run later", isOn: $runLater)
        if runLater {
          DatePicker("Run at", selection: $runAt, in: Date()..., displayedComponents: [.date, .hourAndMinute])
        }
      } header: {
        Text("When")
      } footer: {
        if runLater { Text("Saved as an automation that runs once at this time, then pauses itself.") }
      }
      history
    }
    .formStyle(.grouped)
    .toggleStyle(.argusSwitch)
    .navigationTitle("Quick Run")
    .navigationSubtitle("A playbook, run once, against the projects you pick")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button(runButtonTitle, systemImage: runLater ? "clock" : "play.fill") { runLater ? schedule() : run() }
          .labelStyle(.titleAndIcon)
          .keyboardShortcut(.return, modifiers: .command)
          .disabled(!canRun)
          .help(runLater ? "Save it to run once at the time you picked (⌘↩)" : "Run the playbook now (⌘↩)")
      }
    }
    .task {
      await store.refresh()
      await store.loadSources()
    }
  }

  private var history: some View {
    Section {
      if runs.isEmpty {
        Text("Nothing yet. A quick run is kept and swept like any other run.")
          .foregroundStyle(.secondary)
      }
      ForEach(runs) { run in
        RunHistoryRow(run: run, title: run.automationName) {
          model.navigate(.quickRun(runId: run.id))
        }
      }
    } header: {
      HStack {
        Text("Recent quick runs")
        Spacer()
        Text(AutomationText.plural(runs.count, "run")).foregroundStyle(.secondary)
      }
    }
  }

  private var runButtonTitle: String {
    if starting { return runLater ? "Scheduling…" : "Starting…" }
    return runLater ? "Run Later" : "Run Once"
  }

  private func schedule() {
    starting = true
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let zone = TimeZone.current.identifier
    Task {
      let id = await store.scheduleScratch(
        name: trimmed.isEmpty ? "Quick run" : trimmed, playbook: playbook, repoRoots: repoRoots,
        sourceIds: sourceIds, runAt: OnceTime.string(runAt, timezone: zone), timezone: zone)
      starting = false
      guard let id else { return }
      playbook = ""
      model.navigate(.automation(id: id, runId: nil))
    }
  }

  private func run() {
    starting = true
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    Task {
      let runId = await store.runScratch(
        name: trimmed.isEmpty ? "Quick run" : trimmed, playbook: playbook, repoRoots: repoRoots,
        sourceIds: sourceIds, model: nil, guardrails: RemoteAutomationGuardrails())
      starting = false
      guard let runId else { return }
      playbook = ""
      // Straight to the run: watching it is the point of pressing the button.
      model.navigate(.quickRun(runId: runId))
    }
  }
}
