import ArgusCore
import SwiftUI

/// Rewrite a playbook by describing what should change.
///
/// The rewrite lands in the editor's draft, never on the computer: you read
/// the new text, keep or edit it, and the automation is only changed by the
/// save button on the screen underneath.
public struct RevisePlaybookSheet: View {
  @Environment(AutomationsStore.self) private var store
  @Environment(\.dismiss) private var dismiss

  let playbook: String
  let name: String
  let onApply: (String) -> Void

  @State private var instruction = ""
  @State private var revised: String?
  @State private var revising = false
  @FocusState private var focused: Bool

  private var canRevise: Bool {
    !instruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !revising
  }

  public init(playbook: String, name: String, onApply: @escaping (String) -> Void) {
    self.playbook = playbook
    self.name = name
    self.onApply = onApply
  }

  public var body: some View {
    NavigationStack {
      Screen {
        if let error = store.error {
          Banner(text: error, tone: .danger)
        }
        Field(
          label: "WHAT SHOULD CHANGE?",
          caption: "The whole playbook is rewritten around this; the rest is kept."
        ) {
          ThemedTextField(
            placeholder: "Check for a merged PR before calling a branch unshipped.",
            text: $instruction, multiline: true, lines: 3...8
          )
          .focused($focused)
          Btn(
            label: revising ? "Rewriting…" : (revised == nil ? "Rewrite" : "Rewrite again"),
            tone: .secondary, small: true
          ) { revise() }
            .disabled(!canRevise)
        }

        if let text = revised {
          Field(label: "Revised playbook", caption: "Edit it here if you want.") {
            ThemedTextField(
              placeholder: "Playbook",
              text: Binding(get: { text }, set: { revised = $0 }),
              multiline: true, lines: 8...24, mono: true)
          }
        }
      }
      .navigationTitle("Rewrite the Playbook")
      .inlineNavigationTitle()
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Apply") {
            if let revised { onApply(revised) }
            dismiss()
          }
          .disabled(revised?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
        }
      }
      .task { focused = true }
    }
  }

  private func revise() {
    revising = true
    Task {
      let result = await store.revisePlaybook(
        playbook: playbook, instruction: instruction, name: name.isEmpty ? nil : name)
      revising = false
      guard let result else { return }
      revised = result
    }
  }
}
