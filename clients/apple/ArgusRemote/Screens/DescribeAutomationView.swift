import ArgusUI
import SwiftUI

/// "Describe it": say what an automation should do in a sentence, and the
/// computer drafts it for the editor to review. Nothing is saved here.
///
/// Needs control: drafting spends the computer's Claude account.
struct DescribeAutomationView: View {
  @Environment(Router.self) private var router
  @Environment(AutomationsStore.self) private var store

  @State private var description = ""
  @State private var drafting = false

  var body: some View {
    Screen {
      if let error = store.error {
        Banner(text: error, tone: .danger)
      }
      MutedText(
        "Say what it should do and how often, e.g. “Every weekday at 9, triage new GitHub issues in this repo.”")
      ThemedTextField(
        placeholder: "Describe the automation", text: $description, multiline: true,
        lines: 3...8)
      if drafting {
        Loading(label: "Drafting it…")
      } else {
        Btn(label: "Draft it", small: true, icon: Icon.agent) { draft() }
          .disabled(description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
    }
    .navigationTitle("Describe an Automation")
    .navigationBarTitleDisplayMode(.inline)
  }

  private func draft() {
    drafting = true
    let text = description
    Task {
      let result = await store.draftOverGateway(description: text)
      drafting = false
      guard let result else { return }
      router.push(.automationDraft(detail: result.automation, notes: result.notes))
    }
  }
}
