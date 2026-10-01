import ArgusUI
import SwiftUI

/// Run a playbook once, with nothing saved behind it.
///
/// The same spec an automation carries — scope, sources, autonomy, guardrails
/// — minus the clock. The computer models it as a synthetic automation, so the
/// ladder and the spend ceilings apply exactly as they do to a scheduled run.
struct QuickRunView: View {
  @Environment(AppStore.self) private var app
  @Environment(Router.self) private var router
  @Environment(AutomationsStore.self) private var store
  @Environment(\.dismiss) private var dismiss

  @State private var draft = RemoteAutomationDetail(name: "Quick run", triggerKind: .manual)
  @State private var starting = false

  private var canRun: Bool {
    !draft.playbook.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !starting
  }

  var body: some View {
    Screen {
      if let error = store.error {
        Banner(text: error, tone: .danger)
      }
      AutomationFields(draft: $draft, showsSchedule: false, sources: store.sources)
      Btn(label: starting ? "Starting…" : "Run now", icon: Icon.play) { run() }
        .disabled(!canRun)
      MutedText(
        "Nothing is saved. If it turns out to be worth keeping, the run itself "
          + "can be promoted to an automation.")
    }
    .navigationTitle("Quick run")
    .navigationBarTitleDisplayMode(.inline)
    .task { await store.loadSources() }
  }

  private func run() {
    starting = true
    Task {
      let runId = await store.runScratch(
        name: draft.name.trimmingCharacters(in: .whitespacesAndNewlines),
        playbook: draft.playbook,
        repoRoots: draft.repoRoots,
        sourceIds: draft.sourceIds,
        model: draft.model,
        guardrails: draft.guardrails)
      starting = false
      guard let runId else { return }
      // Straight to the run: watching it is the point of pressing the button.
      router.push(.run(id: runId, label: draft.name))
    }
  }
}
