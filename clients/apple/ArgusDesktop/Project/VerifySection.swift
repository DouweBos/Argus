import ArgusCore
import ArgusUI
import SwiftUI

/// The `verify` block: what `/implement-ticket` checks before it reports.
struct VerifySection: View {
  @Binding var draft: ArgusConfigDraft

  var body: some View {
    SectionIntro(
      title: "Verify",
      text: "How an agent proves its work here: the checks that must pass after its last change, how it signs in and how to slow the backend down for loading states. The agent picks its devices from the ticket."
    )
    StringListEditor(
      label: "Checks", items: $draft.verifyChecks, placeholder: "pnpm lint",
      emptyLabel: "No checks")
    Section {
      TextField("Sign in", text: $draft.verifySignIn, prompt: Text("/login"))
    } footer: {
      Text("A /skill or a shell command the agent runs to sign in on each device before driving the app.")
    }
    Section {
      Toggle("Screenshot a baseline before changing code", isOn: $draft.verifyBaseline)
    }
    Section {
      TextField("Slow backend", text: $draft.verifySlowBackend, prompt: Text("pnpm proxy --delay 3000"))
    } footer: {
      Text("How to slow the backend down so first loads and loading states can be checked. Leave blank to skip.")
    }
  }
}
