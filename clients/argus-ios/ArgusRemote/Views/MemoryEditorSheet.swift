import ArgusKit
import SwiftUI

/// One automation memory: read it, or with control, edit or delete it.
/// `memory == nil` adds a new one.
struct MemoryEditorSheet: View {
  @Environment(AppStore.self) private var app
  @Environment(AutomationsStore.self) private var store
  @Environment(\.dismiss) private var dismiss

  let automationId: String
  let memory: RemoteAutomationMemory?

  @State private var draft = RemoteAutomationMemory()
  @State private var editing = false
  @State private var saving = false
  @State private var confirmingDelete = false

  private var canSave: Bool {
    [draft.name, draft.description, draft.body].allSatisfy {
      !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    } && !saving
  }

  var body: some View {
    NavigationStack {
      Screen {
        if let error = store.error {
          Banner(text: error, tone: .danger)
        }
        if editing {
          fields
        } else if let memory {
          reader(memory)
        }
      }
      .navigationTitle(memory == nil ? "Add memory" : draft.name)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { toolbar }
      .alert("Delete this memory?", isPresented: $confirmingDelete) {
        Button("Cancel", role: .cancel) {}
        Button("Delete", role: .destructive) { delete() }
      } message: {
        Text("Future runs won't see it.")
      }
      .onAppear {
        draft = memory ?? RemoteAutomationMemory()
        editing = memory == nil
      }
    }
  }

  @ViewBuilder
  private func reader(_ memory: RemoteAutomationMemory) -> some View {
    Card {
      HStack(spacing: 8) {
        Badge(label: memory.type.rawValue)
        Spacer(minLength: 0)
      }
      MutedText(memory.description)
    }
    Card { MarkdownView(text: memory.body, baseSize: 14) }
    if app.hasControl {
      Btn(label: "Delete memory", tone: .danger, small: true) { confirmingDelete = true }
    }
  }

  @ViewBuilder
  private var fields: some View {
    Field(label: "NAME", caption: "Lowercase kebab-case; also the file name.") {
      ThemedTextField(placeholder: "session-merge-flow", text: $draft.name, mono: true)
    }
    Field(label: "TYPE") {
      SegmentedControl(
        value: $draft.type,
        options: RemoteAutomationMemory.Kind.allCases.map { ($0, $0.rawValue.capitalized) })
    }
    Field(label: "DESCRIPTION", caption: "One line, shown in the index every run reads.") {
      ThemedTextField(placeholder: "Where session merges are implemented", text: $draft.description)
    }
    Field(label: "MEMORY") {
      ThemedTextField(
        placeholder: "Markdown", text: $draft.body, multiline: true, lines: 8...24, mono: true)
    }
  }

  @ToolbarContentBuilder
  private var toolbar: some ToolbarContent {
    ToolbarItem(placement: .cancellationAction) {
      Button(editing && memory != nil ? "Cancel" : "Close") {
        if editing, let memory {
          draft = memory
          editing = false
        } else {
          dismiss()
        }
      }
    }
    if app.hasControl {
      ToolbarItem(placement: .confirmationAction) {
        if editing {
          Button(saving ? "Saving…" : "Save") { save() }.disabled(!canSave)
        } else {
          Button("Edit") { editing = true }
        }
      }
    }
  }

  private func save() {
    saving = true
    Task {
      let saved = await store.saveMemory(
        automationId: automationId, memory: draft, previousName: memory?.name)
      saving = false
      if saved { dismiss() }
    }
  }

  private func delete() {
    guard let memory else { return }
    Task {
      if await store.deleteMemory(automationId: automationId, name: memory.name) {
        dismiss()
      }
    }
  }
}
