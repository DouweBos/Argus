import ArgusUI
import SwiftUI

/// `/blueprints/:id`, or `/blueprints/new`: one blueprint, every field
/// editable, and the projects made from it. Nothing saves until Save.
///
/// A monitor device reads it; writing needs control.
struct BlueprintEditorView: View {
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(BlueprintsStore.self) private var store
  @Environment(AutomationsStore.self) private var automations
  @Environment(\.dismiss) private var dismiss

  /// Nil writes a new one, from a generated draft when there is one.
  let blueprintId: String?

  @State private var form = BlueprintForm()
  @State private var loaded = false
  @State private var saving = false
  @State private var confirmingDelete = false

  private var isNew: Bool { blueprintId == nil }
  private var canSave: Bool { host.hasControl && form.problem == nil && !saving }

  var body: some View {
    List {
      if let error = store.error {
        Banner(text: error, tone: .danger).listRowBackground(Color.clear)
      }
      if loaded {
        if form.fromDraft {
          Banner(
            text: "Claude drafted this from your projects. Read it through before saving.", tone: .muted,
            title: "Draft"
          )
          .listRowBackground(Color.clear)
        }
        if let blueprintId, host.hasControl {
          Section {
            Button {
              router.push(.newProject(blueprintId: blueprintId))
            } label: {
              Label("New Project from This Blueprint", systemImage: BlueprintSymbol.newProject)
            }
          }
        }
        BlueprintFormSections(form: $form, runners: automations.runners)
          .disabled(!host.hasControl)
        history
        if let problem = form.problem, host.hasControl {
          MutedText(problem).listRowBackground(Color.clear)
        }
        if !isNew, host.hasControl {
          Section {
            Button("Delete Blueprint", role: .destructive) { confirmingDelete = true }
          }
        }
      } else {
        Loading(label: "Reading the blueprint").listRowBackground(Color.clear)
      }
    }
    .scrollDismissesKeyboard(.interactively)
    .navigationTitle(isNew ? "New Blueprint" : (form.name.isEmpty ? "Blueprint" : form.name))
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if host.hasControl {
        ToolbarItem(placement: .confirmationAction) {
          Button(saving ? "Saving" : "Save") { save() }.disabled(!canSave)
        }
      }
    }
    .alert("Delete this blueprint?", isPresented: $confirmingDelete) {
      Button("Cancel", role: .cancel) {}
      Button("Delete", role: .destructive) { delete() }
    } message: {
      Text("Projects already made from it stay where they are.")
    }
    .task { await load() }
    .reportsBlueprintScreen(.editor)
  }

  /// The projects made from it, newest first; a finished one opens its session.
  @ViewBuilder
  private var history: some View {
    let runs = blueprintId.map(store.runs(for:)) ?? []
    if !runs.isEmpty {
      Section("Projects made from it") {
        ForEach(runs, id: \.id) { run in
          if let sessionId = run.sessionId {
            NavigationLink(value: Route.session(id: sessionId, label: run.projectName, repoRoot: run.repoRoot)) {
              BlueprintRunRow(run: run)
            }
          } else {
            BlueprintRunRow(run: run)
          }
        }
      }
    }
  }

  private func load() async {
    guard !loaded else { return }
    if automations.runners.isEmpty { await automations.loadRunners() }
    if let blueprintId {
      if store.blueprint(id: blueprintId) == nil { await store.refresh() }
      if let blueprint = store.blueprint(id: blueprintId) { form = BlueprintForm(blueprint) }
    } else if let draft = store.pendingDraft {
      form = draft
      store.pendingDraft = nil
    }
    loaded = true
  }

  private func save() {
    saving = true
    Task {
      let id = await store.save(id: blueprintId, form: form)
      saving = false
      guard id != nil else { return }
      dismiss()
    }
  }

  private func delete() {
    guard let blueprintId else { return }
    Task {
      guard await store.delete(id: blueprintId) else { return }
      dismiss()
    }
  }
}
