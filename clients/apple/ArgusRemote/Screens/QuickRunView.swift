import ArgusUI
import SwiftUI

/// Run a playbook once against the projects you pick, with nothing saved
/// behind it — and the quick runs so far, underneath. The Mac's Quick Run.
///
/// Autonomy isn't offered: an ad-hoc run inherits the computer's default,
/// floored by each project, and its spend ceilings apply as to any run.
struct QuickRunView: View {
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(AutomationsStore.self) private var store

  @State private var name = ""
  @State private var playbook = ""
  @State private var repoRoots: [String] = []
  @State private var sourceIds: [String] = []
  @State private var starting = false

  private var canRun: Bool {
    host.hasControl && !playbook.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !starting
  }

  private var runs: [RemoteAutomationRun] { store.quickRuns ?? [] }

  var body: some View {
    Screen {
      if let error = store.error {
        Banner(text: error, tone: .danger)
      }
      Field(
        label: "What should it do?",
        caption: "Nothing is saved — but you can turn a run into an automation afterwards. The run "
          + "reads the projects at their paths and never writes to them."
      ) {
        ThemedTextField(placeholder: "Quick run", text: $name, input: .name)
        ThemedTextField(
          placeholder: "Summarise what landed on each project this week.", text: $playbook,
          multiline: true, lines: 6...24, mono: true)
      }
      Field(label: "Projects") {
        ToggleList(
          options: AutomationFields.projectOptions(host.projects, picked: repoRoots),
          selection: $repoRoots,
          emptyMessage: "This computer has no projects registered.")
      }
      if !store.sources.isEmpty {
        Field(label: "Signal sources", caption: "What feeds the run its work.") {
          ToggleList(
            options: store.sources.map {
              .init(id: $0.id, label: $0.label, hint: $0.available ? nil : "not configured")
            },
            selection: $sourceIds)
        }
      }
      if host.hasControl {
        Btn(label: starting ? "Starting…" : "Run once", icon: Icon.play) { run() }
          .disabled(!canRun)
      }
      history
    }
    .navigationTitle("Quick Run")
    .navigationBarTitleDisplayMode(.inline)
    .task {
      await store.loadQuickRunsOverGateway()
      await store.loadSources()
    }
    .refreshable { await store.loadQuickRunsOverGateway() }
    .liveRefresh(enabled: host.connection == .ready) { await store.loadQuickRunsOverGateway() }
  }

  @ViewBuilder
  private var history: some View {
    SectionHeader(title: "Quick runs", count: runs.count)
    if store.quickRuns == nil {
      Loading(label: "Reading quick runs…")
    } else if runs.isEmpty {
      MutedText("Nothing yet. A quick run is kept and swept like any other run.")
    }
    ForEach(runs) { run in
      NavigationLink(value: Route.run(id: run.id, label: run.automationName)) {
        RunRow(run: run, showName: true)
      }
    }
  }

  private func run() {
    starting = true
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let label = trimmed.isEmpty ? "Quick run" : trimmed
    Task {
      let runId = await store.runScratch(
        name: label, playbook: playbook, repoRoots: repoRoots,
        sourceIds: sourceIds, model: nil, guardrails: RemoteAutomationGuardrails())
      starting = false
      guard let runId else { return }
      playbook = ""
      // Straight to the run: watching it is the point of pressing the button.
      router.push(.run(id: runId, label: label))
    }
  }
}
