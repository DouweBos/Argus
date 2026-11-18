import ArgusCore
import ArgusUI
import SwiftUI

/// `/blueprints/:blueprintId` — the blueprint's editor and the projects made
/// from it — or `/blueprints/new`, prefilled from a generated draft when there is one.
struct BlueprintScreen: View {
  @Environment(DesktopModel.self) private var model
  @Environment(BlueprintsStore.self) private var store
  let blueprintId: String?

  @State private var form = BlueprintForm()
  /// What the host holds, so Save only lights up on a real change.
  @State private var saved: BlueprintForm?
  @State private var saving = false
  @State private var confirmingDelete = false

  private var blueprint: ArgusProtocol.Blueprint? { blueprintId.flatMap(store.blueprint(id:)) }

  var body: some View {
    Group {
      if blueprintId == nil || saved != nil {
        editor
      } else if store.loaded {
        EmptyState(
          icon: BlueprintText.icon, title: "Blueprint not found", body: "It may have been deleted on this computer."
        ) {
          Button("Back to Blueprints") { model.navigate(.blueprints) }
        }
      } else {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .navigationTitle(blueprintId == nil ? "New Blueprint" : (blueprint?.name ?? "Blueprint"))
    .navigationSubtitle(subtitle)
    .toolbar { toolbar }
    .confirmationDialog("Delete this blueprint?", isPresented: $confirmingDelete) {
      Button("Delete Blueprint", role: .destructive) { delete() }
    } message: {
      Text("Projects already made from it stay as they are.")
    }
    .onAppear(perform: load)
    .onChange(of: blueprint == nil) { load() }
    .task { await store.refresh() }
  }

  private var subtitle: String {
    if blueprintId == nil { return form.fromDraft ? "Drafted by Claude, review it before saving" : "" }
    return blueprint.map { "\($0.scaffoldLabel) · \(BlueprintText.references($0.references.count))" } ?? ""
  }

  private var editor: some View {
    Form {
      if let error = store.error {
        Section { Banner(text: error, tone: .danger) }
      }
      BlueprintEditorForm(form: $form)
      if let blueprintId { runHistory(blueprintId) }
    }
    .formStyle(.grouped)
    .toggleStyle(.argusSwitch)
  }

  private func runHistory(_ id: String) -> some View {
    let runs = store.runs(for: id)
    return Section {
      if runs.isEmpty {
        Text("No projects made from this blueprint yet.").foregroundStyle(.secondary)
      }
      ForEach(runs, id: \.id) { BlueprintRunRow(run: $0) }
    } header: {
      HStack {
        Text("Projects")
        Spacer()
        Text(AutomationText.plural(runs.count, "project")).foregroundStyle(.secondary)
      }
    }
  }

  @ToolbarContentBuilder
  private var toolbar: some ToolbarContent {
    ToolbarItemGroup {
      if let blueprintId {
        Button("Delete") { confirmingDelete = true }
        Button { model.navigate(.newProject(blueprintId: blueprintId)) } label: {
          Label("New Project", systemImage: "plus")
        }
        .labelStyle(.titleAndIcon)
        .disabled(saved != form)
        .help(saved != form ? "Save your changes first" : "Start a project from this blueprint")
      }
      Button(saveTitle) { save() }
        .keyboardShortcut("s", modifiers: .command)
        .disabled(saving || saved == form || form.problem != nil)
        .help(form.problem ?? "")
    }
  }

  private var saveTitle: String {
    if saving { return "Saving" }
    if blueprintId == nil { return "Save Blueprint" }
    return saved == form ? "Saved" : "Save Changes"
  }

  /// Seeds the form once: from the saved blueprint, or a waiting draft.
  private func load() {
    guard saved == nil else { return }
    if let blueprint {
      form = BlueprintForm(blueprint)
      saved = form
    } else if blueprintId == nil, let draft = store.pendingDraft {
      form = draft
      store.pendingDraft = nil
    }
  }

  private func save() {
    saving = true
    Task {
      defer { saving = false }
      guard let id = await store.save(id: blueprintId, form: form) else { return }
      if blueprintId == nil {
        model.navigate(.blueprint(id: id))
      } else if let blueprint = store.blueprint(id: id) {
        form = BlueprintForm(blueprint)
        saved = form
      }
    }
  }

  private func delete() {
    guard let blueprintId else { return }
    Task {
      guard await store.delete(id: blueprintId) else { return }
      model.navigate(.blueprints)
    }
  }
}
