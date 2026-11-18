import ArgusCore
import SwiftUI

/// Rewrite a blueprint's instructions by describing what Claude got wrong.
/// Claude may re-read the reference projects to get the facts right.
public struct ReviseBlueprintSheet: View {
  @Environment(BlueprintsStore.self) private var store

  let form: BlueprintForm
  let onApply: (String) -> Void

  public init(form: BlueprintForm, onApply: @escaping (String) -> Void) {
    self.form = form
    self.onApply = onApply
  }

  public var body: some View {
    ReviseTextSheet(
      copy: ReviseTextCopy(
        title: "Revise the Instructions",
        subtitle: "Say what's wrong or missing; Claude rewrites the instructions and checks the reference projects.",
        placeholder: "Leave out the Node setup; the new app is Swift only.",
        explanation: "The instructions are rewritten around this; the rest is kept.",
        savedHint: "Nothing is saved until you save the blueprint.",
        resultLabel: "Revised instructions",
        progress: "Revising the instructions"),
      error: store.error,
      revise: { note in await store.revise(form, note: note) },
      onApply: onApply)
  }
}
