import ArgusUI
import SwiftUI

/// Who a teammate is and the defaults its duties inherit: identity, soul,
/// scope, autonomy and guardrails. Saving is explicit; nothing autosaves.
struct TeammateProfileView: View {
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(TeammatesStore.self) private var store
  @Environment(AutomationsStore.self) private var automations
  @Environment(\.dismiss) private var dismiss

  let teammateId: String

  @State private var draft: TeammateDraft?
  @State private var saved: TeammateDraft?
  @State private var saving = false
  @State private var confirmingDelete = false
  @State private var revisingSoul = false

  private var canSave: Bool {
    guard let draft, host.hasControl else { return false }
    return draft != saved && draft.canSave && !saving && host.connection == .ready
  }

  var body: some View {
    Screen {
      if let error = store.error {
        Banner(text: error, tone: .danger)
      }
      if let draft = Binding($draft) {
        form(draft)
          .disabled(!host.hasControl)
        if host.hasControl {
          Btn(label: "Delete teammate", tone: .danger, small: true) { confirmingDelete = true }
        }
      } else {
        Loading(label: "Reading the teammate")
      }
    }
    .navigationTitle("Profile")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if host.hasControl {
        ToolbarItem(placement: .confirmationAction) {
          Button(saving ? "Saving" : "Save") { save() }.disabled(!canSave)
        }
      }
    }
    .confirmationDialog(
      "Delete \(draft?.name ?? "this teammate")?", isPresented: $confirmingDelete, titleVisibility: .visible
    ) {
      Button("Delete, keep its duties") { delete(keepDuties: true) }
      Button("Delete with its duties", role: .destructive) { delete(keepDuties: false) }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("Kept duties become standalone automations, paused. Its memory and conversations are deleted.")
    }
    .task { await load() }
  }

  @ViewBuilder
  private func form(_ draft: Binding<TeammateDraft>) -> some View {
    Field(label: "Identity") {
      HStack(spacing: 12) {
        TeammateAvatar(
          name: draft.wrappedValue.name, color: draft.wrappedValue.color, avatar: draft.wrappedValue.avatar,
          size: 44)
        VStack(alignment: .leading, spacing: 2) {
          BodyText(draft.wrappedValue.name.isEmpty ? "Unnamed" : draft.wrappedValue.name)
          MutedText("@\(draft.wrappedValue.handle)")
        }
      }
      ThemedTextField(placeholder: "Name", text: draft.name, input: .name)
      ThemedTextField(placeholder: "handle", text: draft.handle, mono: true, input: .code)
      if !draft.wrappedValue.handle.isEmpty, let error = draft.wrappedValue.handleError {
        MutedText(error)
      }
      ThemedTextField(placeholder: "One line about what it does", text: draft.tagline)
    }
    Field(label: "Look") {
      TeammateLookPicker(name: draft.wrappedValue.name, color: draft.color, symbol: draft.symbol)
    }
    Field(label: "Soul", caption: "Its persona, in Markdown. Every conversation and duty starts from it.") {
      ThemedTextField(
        placeholder: "Who it is and how it works", text: draft.soul,
        multiline: true, lines: 8...30, mono: true)
      if host.hasControl {
        Btn(label: "Rewrite with Claude", tone: .secondary, small: true) { revisingSoul = true }
          .disabled(draft.wrappedValue.soul.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
    }
    .sheet(isPresented: $revisingSoul) {
      ReviseSoulSheet(soul: draft.wrappedValue.soul, name: draft.wrappedValue.name) { rewritten in
        draft.wrappedValue.soul = rewritten
      }
    }
    Field(label: "Scope", caption: "Repos its duties and conversations may read, and what feeds it work.") {
      ToggleList(
        title: "Projects",
        options: AutomationFields.projectOptions(host.projects, picked: draft.wrappedValue.repoRoots),
        selection: draft.repoRoots,
        emptyMessage: "This computer has no projects registered.")
      ToggleList(
        title: "Signal sources",
        options: automations.sources.map {
          .init(id: $0.id, label: $0.label, hint: $0.available ? nil : "not configured")
        },
        selection: draft.sourceIds,
        emptyMessage: "This computer reported no signal sources.")
    }
    Field(
      label: "Behaviour",
      caption: draft.wrappedValue.autonomy?.caption
        ?? "A ceiling for its duties and its chat; the computer takes the lowest of this and its own caps."
    ) {
      MenuChip("Autonomy", selection: autonomyBinding(draft), options: autonomyOptions, showsTitle: true)
        .frame(maxWidth: .infinity, alignment: .leading)
      GuardrailFields(guardrails: draft.guardrails)
    }
  }

  private var autonomyOptions: [MenuChip<String>.Option] {
    [.init(value: "", label: "Inherit", hint: "Use the computer's default")]
      + RemoteAutonomy.allRungs.map { .init(value: $0.rawValue, label: $0.label, hint: $0.caption) }
  }

  private func autonomyBinding(_ draft: Binding<TeammateDraft>) -> Binding<String> {
    Binding(
      get: { draft.wrappedValue.autonomy?.rawValue ?? "" },
      set: { draft.wrappedValue.autonomy = RemoteAutonomy(rawValue: $0) })
  }

  private func load() async {
    await automations.loadSources()
    guard let detail = await store.loadDetail(id: teammateId) else { return }
    let loaded = TeammateDraft(detail.teammate, soul: detail.soul)
    draft = loaded
    saved = loaded
  }

  private func save() {
    guard let draft, let saved else { return }
    saving = true
    Task {
      var ok = true
      var identity = draft
      identity.soul = saved.soul
      if identity != saved {
        ok = await store.update(teammateId, draft.patch, clear: draft.clearedFields)
      }
      if ok, draft.soul != saved.soul {
        ok = await store.saveSoul(teammateId, soul: draft.soul)
      }
      saving = false
      if ok {
        self.saved = draft
        dismiss()
      }
    }
  }

  private func delete(keepDuties: Bool) {
    Task {
      guard await store.delete(teammateId, keepDuties: keepDuties) else { return }
      // The teammate and every page of it are gone.
      router.popToRoot()
    }
  }
}
