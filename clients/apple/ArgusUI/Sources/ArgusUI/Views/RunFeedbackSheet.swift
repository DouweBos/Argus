import ArgusCore
import SwiftUI

/// Arguing with a report. The note goes to the run's own agent, which is
/// picked back up where it stopped and publishes a corrected report.
///
/// The toggle is the whole safety story: by default feedback only ever adds
/// proposals, so disagreeing about one thing cannot quietly empty the inbox of
/// everything else. Turning it on is the user saying "yes, take that one out".
public struct RunFeedbackSheet: View {
  @Environment(\.theme) private var theme
  @Environment(AutomationsStore.self) private var store
  @Environment(\.dismiss) private var dismiss

  let runId: String

  @State private var note = ""
  @State private var allowClearing = false
  @State private var sending = false
  @FocusState private var focused: Bool

  private var canSend: Bool {
    !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !sending
  }

  public init(runId: String) {
    self.runId = runId
  }

  public var body: some View {
    NavigationStack {
      Screen {
        if let error = store.error {
          Banner(text: error, tone: .danger)
        }
        Field(
          label: "WHAT DID IT GET WRONG?",
          caption: "The run's agent picks up where it left off, checks what it claimed, "
            + "and publishes a corrected report."
        ) {
          ThemedTextField(
            placeholder: "The flaky snapshot test isn't a nice-to-have — it's failed every "
              + "morning for a week.",
            text: $note, multiline: true, lines: 3...8
          )
          .focused($focused)
        }

        Field(
          label: "LET IT REMOVE PROPOSALS",
          caption: "Off, feedback can only add to the inbox. Turn it on only if you are "
            + "asking for something in there to go."
        ) {
          Toggle("It may withdraw or supersede what your note names", isOn: $allowClearing)
            .font(.scaled(size: 14))
            .tint(theme.accent)
        }
      }
      .navigationTitle("Give feedback")
      .inlineNavigationTitle()
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(sending ? "Sending…" : "Send") { send() }
            .disabled(!canSend)
        }
      }
      .task { focused = true }
    }
  }

  private func send() {
    sending = true
    Task {
      let ok = await store.sendRunFeedback(
        id: runId, note: note, allowClearing: allowClearing)
      sending = false
      if ok { dismiss() }
    }
  }
}
