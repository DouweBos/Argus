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
  @State private var starting = false

  private var runs: [RemoteAutomationRun] { store.runs.filter(\.isQuick) }

  var body: some View {
    Form {
      Section {
        TextField("Name", text: $name, prompt: Text("Quick run"))
        TextEditor(text: $playbook)
          .font(.system(.body, design: .monospaced))
          .frame(minHeight: 200)
          .overlay(alignment: .topLeading) {
            if playbook.isEmpty {
              Text("Summarise what landed on each project this week.")
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(.tertiary)
                .padding(.leading, 5)
                .allowsHitTesting(false)
            }
          }
        LabeledContent("Projects") {
          VStack(alignment: .trailing, spacing: 4) {
            if host.projects.isEmpty, host.projectsLoaded { Text("No projects are open.").foregroundStyle(.secondary) }
            ForEach(host.projects) { project in
              Toggle(project.name, isOn: member(project.repoRoot)).help(HostScopedPath.path(project.repoRoot))
            }
          }
        }
        if let error = store.error { Banner(text: error, tone: .danger) }
      } header: {
        HStack {
          Text("What should it do?")
          Spacer()
          Button(starting ? "Starting…" : "Run Once") { run() }
            .keyboardShortcut(.return, modifiers: .command)
            .disabled(starting || playbook.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
      } footer: {
        Text(
          "Nothing is saved — but you can turn a run into an automation afterwards. The run reads "
            + "the projects at their absolute paths and never writes to them.")
      }
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
          Text("Quick runs")
          Spacer()
          Text(AutomationText.plural(runs.count, "run")).foregroundStyle(.secondary)
        }
      }
    }
    .formStyle(.grouped)
    .toggleStyle(.argusSwitch)
    .navigationTitle("Quick Run")
    .navigationSubtitle("A playbook, run once, against the projects you pick")
    .task { await store.refresh() }
  }

  private func member(_ root: String) -> Binding<Bool> {
    Binding(
      get: { repoRoots.contains(root) },
      set: { on in
        repoRoots.removeAll { $0 == root }
        if on { repoRoots.append(root) }
      })
  }

  private func run() {
    starting = true
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    Task {
      let runId = await store.runScratch(
        name: trimmed.isEmpty ? "Quick run" : trimmed, playbook: playbook, repoRoots: repoRoots,
        sourceIds: [], model: nil, guardrails: RemoteAutomationGuardrails())
      starting = false
      guard let runId else { return }
      playbook = ""
      // Straight to the run: watching it is the point of pressing the button.
      model.navigate(.quickRun(runId: runId))
    }
  }
}
