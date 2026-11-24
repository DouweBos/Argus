import ArgusCore
import SwiftUI

/// Rewrite a teammate's soul by describing what should change.
public struct ReviseSoulSheet: View {
  @Environment(TeammatesStore.self) private var store

  let soul: String
  let name: String
  let onApply: (String) -> Void

  public init(soul: String, name: String, onApply: @escaping (String) -> Void) {
    self.soul = soul
    self.name = name
    self.onApply = onApply
  }

  public var body: some View {
    ReviseTextSheet(
      copy: ReviseTextCopy(
        title: "Rewrite the Soul",
        subtitle: "Say what should change; Claude rewrites the soul around it.",
        placeholder: "Be blunter in reviews, and always link the failing job.",
        explanation: "The whole soul is rewritten around this; the rest is kept.",
        savedHint: "Nothing is saved until you save the profile.",
        resultLabel: "Revised soul",
        progress: "Rewriting the soul"),
      error: store.error,
      revise: { instruction in
        await store.reviseSoul(name: name, soul: soul, instruction: instruction)
      },
      onApply: onApply)
  }
}
