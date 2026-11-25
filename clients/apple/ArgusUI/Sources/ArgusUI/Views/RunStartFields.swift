import ArgusCore
import SwiftUI

/// What happens before a run's agent starts: an optional precheck command
/// that must exit 0, and whether it picks up the previous run's conversation.
/// Each part is hidden on a computer too old to have it.
public struct RunStartFields: View {
  @Binding var draft: RemoteAutomationDetail

  public init(draft: Binding<RemoteAutomationDetail>) {
    self._draft = draft
  }

  public var body: some View {
    Field(label: "Before each run", caption: AutomationText.precheckCaption) {
      if draft.precheckCommand != nil {
        MutedText("Precheck command — blank runs every time.")
        ThemedTextField(
          placeholder: "./scripts/has-new-work.sh",
          text: Binding(get: { draft.precheckCommand ?? "" }, set: { draft.precheckCommand = $0 }),
          multiline: true, lines: 1...4, mono: true, input: .code)
        MutedText("Timeout (seconds)")
        ThemedTextField(
          placeholder: "60",
          text: Binding(
            get: { String(Int(draft.precheckTimeoutSeconds ?? AutomationText.defaultPrecheckTimeout)) },
            set: { draft.precheckTimeoutSeconds = AutomationText.precheckTimeout(parsing: $0) }),
          keyboard: .decimalPad, mono: true, input: .code)
      }
      if draft.continueConversation != nil {
        Toggle(
          "Continue the previous run's conversation",
          isOn: Binding(get: { draft.continueConversation ?? false }, set: { draft.continueConversation = $0 })
        )
        .font(.scaled(size: 14))
        .toggleStyle(.argusSwitch)
        MutedText(AutomationText.continueCaption)
      }
    }
  }
}
