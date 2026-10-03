import ArgusCore
import ArgusUI
import SwiftUI

/// "Describe it": a sentence in, a draft automation out, for review. It saves
/// disabled — a generated automation is never live on arrival.
struct DescribeAutomationSheet: View {
  @Environment(DesktopModel.self) private var model
  @Environment(AutomationsStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme

  @State private var text = ""
  @State private var draft: ArgusProtocol.AutomationDraft?
  @State private var name = ""
  @State private var summary = ""
  @State private var playbook = ""
  @State private var schedule: ArgusProtocol.AutomationTriggerSchedule?
  @State private var working = false

  var body: some View {
    VStack(spacing: 0) {
      Form {
        Section {
          TextField(
            "What should it do?", text: $text,
            prompt: Text(
              "Every weekday at 8am, look at my open PRs and tell me which ones have gone stale."),
            axis: .vertical
          )
          .lineLimit(2...5)
        } footer: {
          Text("One or two sentences. Say when it should run and what you want back.")
        }
        if let draft { review(draft) }
        if let error = store.error { Section { Text(error).foregroundStyle(theme.error) } }
      }
      .formStyle(.grouped)
      HStack {
        Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
        Spacer()
        Button(working && draft != nil ? "Regenerating…" : draft == nil ? "Draft It" : "Regenerate") {
          generate()
        }
        .disabled(working || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        if draft != nil {
          Button("Create Automation") { create() }
            .keyboardShortcut(.defaultAction)
            .disabled(working)
        }
      }
      .padding()
    }
    .frame(width: 560, height: draft == nil ? 260 : 620)
  }

  @ViewBuilder
  private func review(_ draft: ArgusProtocol.AutomationDraft) -> some View {
    if !draft.notes.isEmpty {
      Section("Notes") {
        ForEach(draft.notes, id: \.self) { Text($0).foregroundStyle(.secondary) }
      }
    }
    Section("Draft") {
      TextField("Name", text: $name)
      TextField("Description", text: $summary)
      if let schedule {
        LabeledContent("Schedule", value: "\(schedule.cron) · \(schedule.timezone)")
      } else {
        LabeledContent("Trigger", value: "Manual")
      }
      TextEditor(text: $playbook)
        .font(.system(.body, design: .monospaced))
        .frame(minHeight: 180)
    }
    Section {
      Text(
        "\(scopeLabel(draft)) · autonomy inherits the app default. Saves disabled — turn it on "
          + "once you have read it."
      )
      .font(.caption).foregroundStyle(.secondary)
    }
  }

  private func scopeLabel(_ draft: ArgusProtocol.AutomationDraft) -> String {
    let projects = draft.input.scope?.repoRoots.count ?? 0
    let sources = draft.input.sourceIds?.count ?? 0
    return (projects == 0 ? "No projects" : AutomationText.plural(projects, "project")) + " · "
      + (sources == 0 ? "no signal sources" : AutomationText.plural(sources, "source"))
  }

  private func generate() {
    working = true
    Task {
      if let result = await store.draft(description: text) {
        draft = result
        name = result.input.name
        summary = result.input.description ?? ""
        playbook = result.input.playbook
        if case .schedule(let value) = result.input.trigger { schedule = value } else { schedule = nil }
      }
      working = false
    }
  }

  private func create() {
    guard var input = draft?.input else { return }
    input.name = name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "New automation" : name
    input.description = summary.trimmingCharacters(in: .whitespacesAndNewlines)
    input.playbook = playbook
    input.enabled = false
    input.autonomy = nil
    working = true
    Task {
      let id = await store.create(input)
      working = false
      guard let id else { return }
      dismiss()
      model.navigate(.automation(id: id, runId: nil))
    }
  }
}
