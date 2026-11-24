import ArgusCore
import SwiftUI

/// One automation memory: read it, or with control, edit or delete it.
/// `memory == nil` adds a new one.
public struct MemoryEditorSheet: View {
  @Environment(AutomationsStore.self) private var store
  let automationId: String
  let memory: RemoteAutomationMemory?

  public init(automationId: String, memory: RemoteAutomationMemory? = nil) {
    self.automationId = automationId
    self.memory = memory
  }

  public var body: some View {
    MemoryEditor(
      memory: memory, error: store.error, readerNote: "Future runs won't see it.",
      onSave: { draft, previous in
        await store.saveMemory(automationId: automationId, memory: draft, previousName: previous)
      },
      onDelete: { name in await store.deleteMemory(automationId: automationId, name: name) })
  }
}

/// One teammate memory — the one every duty and conversation of it shares.
public struct TeammateMemoryEditorSheet: View {
  @Environment(TeammatesStore.self) private var store
  let teammateId: String
  let memory: RemoteAutomationMemory?

  public init(teammateId: String, memory: RemoteAutomationMemory? = nil) {
    self.teammateId = teammateId
    self.memory = memory
  }

  public var body: some View {
    MemoryEditor(
      memory: memory, error: store.error, readerNote: "Its duties and conversations won't see it.",
      onSave: { draft, previous in
        await store.saveMemory(teammateId: teammateId, memory: draft, previousName: previous)
      },
      onDelete: { name in await store.deleteMemory(teammateId: teammateId, name: name) })
  }
}

/// Read a memory, or with control edit or delete it, whoever owns it.
struct MemoryEditor: View {
  @Environment(HostStore.self) private var host
  @Environment(\.dismiss) private var dismiss

  let memory: RemoteAutomationMemory?
  let error: String?
  let readerNote: String
  let onSave: (RemoteAutomationMemory, String?) async -> Bool
  let onDelete: (String) async -> Bool

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
        if let error {
          Banner(text: error, tone: .danger)
        }
        if editing {
          fields
        } else if let memory {
          reader(memory)
        }
      }
      .navigationTitle(memory == nil ? "Add Memory" : draft.name)
      .inlineNavigationTitle()
      .toolbar { toolbar }
      .alert("Delete this memory?", isPresented: $confirmingDelete) {
        Button("Cancel", role: .cancel) {}
        Button("Delete", role: .destructive) { remove() }
      } message: {
        Text(readerNote)
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
    if host.hasControl {
      Btn(label: "Delete memory", tone: .danger, small: true) { confirmingDelete = true }
    }
  }

  @ViewBuilder
  private var fields: some View {
    Field(label: "Name", caption: "Lowercase kebab-case; also the file name.") {
      ThemedTextField(
        placeholder: "session-merge-flow", text: $draft.name, mono: true, input: .code)
    }
    Field(label: "Type") {
      SegmentedControl(
        value: $draft.type,
        options: RemoteAutomationMemory.Kind.allCases.map { ($0, $0.rawValue.capitalized) })
    }
    Field(label: "Description", caption: "One line, shown in the index every run reads.") {
      ThemedTextField(placeholder: "Where session merges are implemented", text: $draft.description)
    }
    Field(label: "Memory") {
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
    if host.hasControl {
      ToolbarItem(placement: .confirmationAction) {
        if editing {
          Button(saving ? "Saving" : "Save") { save() }.disabled(!canSave)
        } else {
          Button("Edit") { editing = true }
        }
      }
    }
  }

  private func save() {
    saving = true
    Task {
      let saved = await onSave(draft, memory?.name)
      saving = false
      if saved { dismiss() }
    }
  }

  private func remove() {
    guard let memory else { return }
    Task {
      if await onDelete(memory.name) {
        dismiss()
      }
    }
  }
}
