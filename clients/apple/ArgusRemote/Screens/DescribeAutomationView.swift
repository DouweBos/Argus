import ArgusUI
import SwiftUI

/// "Describe it": a sentence in, a draft automation out, reviewed right
/// underneath — the Mac's describe sheet. It saves paused: a generated
/// automation is never live on arrival.
///
/// Needs control: drafting spends the computer's Claude account.
struct DescribeAutomationView: View {
  @Environment(Router.self) private var router
  @Environment(AutomationsStore.self) private var store

  @State private var text = ""
  @State private var draft: RemoteAutomationDetail?
  @State private var notes: [String] = []
  @State private var working = false

  private var canDraft: Bool {
    !working && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  var body: some View {
    Screen {
      if let error = store.error {
        Banner(text: error, tone: .danger)
      }
      Field(
        label: "What should it do?",
        caption: "One or two sentences. Say when it should run and what you want back."
      ) {
        ThemedTextField(
          placeholder: "Every weekday at 8am, look at my open PRs and tell me which ones have gone stale.",
          text: $text, multiline: true, lines: 2...6)
        if working {
          Loading(label: "Drafting it…")
        } else {
          Btn(
            label: draft == nil ? "Draft it" : "Regenerate", tone: draft == nil ? .primary : .secondary,
            small: true, icon: Icon.agent
          ) { generate() }
          .disabled(!canDraft)
        }
      }
      if let binding = Binding($draft) { review(binding) }
    }
    .navigationTitle("Describe an Automation")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if draft != nil {
        ToolbarItem(placement: .confirmationAction) {
          Button("Create") { create() }.disabled(working || !(draft?.hasValidTrigger ?? false))
        }
      }
    }
  }

  @ViewBuilder
  private func review(_ draft: Binding<RemoteAutomationDetail>) -> some View {
    if !notes.isEmpty {
      Banner(text: notes.joined(separator: "\n"), tone: .muted, title: "Adjusted while drafting")
    }
    Field(label: "Draft") {
      ThemedTextField(placeholder: "Name", text: draft.name, input: .name)
      ThemedTextField(placeholder: "Description", text: draft.description, multiline: true)
      schedule(draft.wrappedValue)
      ThemedTextField(
        placeholder: "Playbook", text: draft.playbook, multiline: true, lines: 6...24, mono: true)
    }
    MutedText(
      "\(Self.scopeLabel(draft.wrappedValue)) · autonomy inherits the "
        + "computer's default. Saves paused — turn it on once you have read it.")
  }

  @ViewBuilder
  private func schedule(_ draft: RemoteAutomationDetail) -> some View {
    if draft.triggerKind == .schedule, let cron = draft.cron {
      VStack(alignment: .leading, spacing: 2) {
        if let headline = draft.schedulePreviewText()?.headline { BodyText(headline) }
        MutedText("\(cron) · \(draft.timezone ?? TimeZone.current.identifier)").monospaced()
      }
    } else {
      MutedText("Manual — runs only when someone presses Run now.")
    }
  }

  static func scopeLabel(_ draft: RemoteAutomationDetail) -> String {
    let projects = draft.repoRoots.count
    let sources = draft.sourceIds.count
    return (projects == 0 ? "No projects" : AutomationText.plural(projects, "project")) + " · "
      + (sources == 0 ? "no signal sources" : AutomationText.plural(sources, "source"))
  }

  private func generate() {
    working = true
    let regenerating = draft != nil
    Task {
      if let result = await store.draftOverGateway(description: text, regenerating: regenerating) {
        draft = result.automation
        notes = result.notes
      }
      working = false
    }
  }

  private func create() {
    guard var input = draft else { return }
    if input.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { input.name = "New automation" }
    input.enabled = false
    input.autonomy = nil
    working = true
    Task {
      let id = await store.save(id: nil, input: RemoteAutomationInput(input))
      working = false
      guard let id else { return }
      router.replaceTop(with: .automation(id: id, label: input.name), dropping: 1)
    }
  }
}
