import ArgusCore
import SwiftUI

/// Rewrite an automation's playbook by describing what should change.
public struct RevisePlaybookSheet: View {
  @Environment(AutomationsStore.self) private var store

  let playbook: String
  let name: String
  let onApply: (String) -> Void

  public init(playbook: String, name: String, onApply: @escaping (String) -> Void) {
    self.playbook = playbook
    self.name = name
    self.onApply = onApply
  }

  public var body: some View {
    ReviseTextSheet(
      copy: ReviseTextCopy(
        title: "Rewrite the Playbook",
        subtitle: "Say what should change; Claude rewrites the playbook around it.",
        placeholder: "Check for a merged PR before calling a branch unshipped.",
        explanation: "The whole playbook is rewritten around this; the rest is kept.",
        savedHint: "Nothing is saved until you save the automation.",
        resultLabel: "Revised playbook",
        progress: "Rewriting the playbook"),
      error: store.error,
      revise: { instruction in
        await store.revisePlaybook(playbook: playbook, instruction: instruction, name: name.isEmpty ? nil : name)
      },
      onApply: onApply)
  }
}
