import ArgusUI
import SwiftUI

/// Author one automation: everything the desktop editor holds, including the
/// playbook. Saving is explicit — nothing here autosaves.
///
/// Needs control: a playbook is code that runs unattended on the computer.
struct AutomationEditorView: View {
  @Environment(AppStore.self) private var app
  @Environment(Router.self) private var router
  @Environment(AutomationsStore.self) private var store
  @Environment(\.dismiss) private var dismiss

  /// Nil creates a new automation.
  let automationId: String?

  @State private var draft = RemoteAutomationDetail(extraInstructions: "")
  @State private var loaded = false
  @State private var saving = false
  @State private var confirmingDelete = false

  private var isNew: Bool { automationId == nil }
  private var canSave: Bool {
    !draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && !draft.playbook.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && !saving
  }

  var body: some View {
    Screen {
      if let error = store.error {
        Banner(text: error, tone: .danger)
      }
      if loaded {
        AutomationFields(draft: $draft, sources: store.sources, runners: store.runners)
        if !isNew {
          Btn(label: "Delete automation", tone: .danger, small: true) {
            confirmingDelete = true
          }
        }
      } else {
        Loading(label: "Reading the automation…")
      }
    }
    .navigationTitle(isNew ? "New automation" : "Edit")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .confirmationAction) {
        Button(saving ? "Saving…" : "Save") { save() }
          .disabled(!canSave)
      }
    }
    .alert("Delete this automation?", isPresented: $confirmingDelete) {
      Button("Cancel", role: .cancel) {}
      Button("Delete", role: .destructive) { delete() }
    } message: {
      Text("Its past runs and reports stay on the computer.")
    }
    .task { await load() }
  }

  private func load() async {
    await store.loadSources()
    await store.loadRunners()
    guard let automationId else {
      loaded = true
      return
    }
    if let detail = await store.loadDetail(id: automationId) {
      draft = detail
    }
    loaded = true
  }

  private func save() {
    saving = true
    Task {
      let id = await store.save(id: automationId, input: RemoteAutomationInput(draft))
      saving = false
      guard id != nil else { return }
      dismiss()
    }
  }

  private func delete() {
    guard let automationId else { return }
    Task {
      guard await store.delete(id: automationId) else { return }
      // The automation this editor was opened from is gone, and so is the
      // screen underneath it.
      router.popToRoot()
    }
  }
}
