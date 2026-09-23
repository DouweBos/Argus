import ArgusKit
import SwiftUI

/// Author one automation: everything the desktop editor holds, including the
/// playbook. Saving is explicit — nothing here autosaves.
///
/// Needs control: a playbook is code that runs unattended on the computer.
struct AutomationEditorView: View {
  private enum Sheet: String, Identifiable {
    case projects, sources, autonomy
    var id: String { rawValue }
  }

  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(Router.self) private var router
  @Environment(AutomationsStore.self) private var store
  @Environment(\.dismiss) private var dismiss

  /// Nil creates a new automation.
  let automationId: String?

  @State private var draft = RemoteAutomationDetail()
  @State private var loaded = false
  @State private var saving = false
  @State private var sheet: Sheet?
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
        basics
        trigger
        scope
        behaviour
        playbook
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
    .sheet(item: $sheet) { which in sheetContent(which) }
    .alert("Delete this automation?", isPresented: $confirmingDelete) {
      Button("Cancel", role: .cancel) {}
      Button("Delete", role: .destructive) { delete() }
    } message: {
      Text("Its past runs and reports stay on the computer.")
    }
    .task { await load() }
  }

  // MARK: Sections

  private var basics: some View {
    Field(label: "BASICS") {
      ThemedTextField(placeholder: "Name", text: $draft.name)
      ThemedTextField(placeholder: "What it does", text: $draft.description, multiline: true)
      Toggle("Enabled", isOn: $draft.enabled)
        .font(.system(size: 15))
        .tint(theme.accent)
    }
  }

  private var trigger: some View {
    Field(
      label: "TRIGGER",
      caption: draft.triggerKind == .schedule
        ? "5 fields: minute hour day-of-month month day-of-week."
        : "Only runs when someone presses Run now."
    ) {
      SegmentedControl(
        value: Binding(
          get: { draft.triggerKind },
          set: { draft.triggerKind = $0 }),
        options: [(.schedule, "Schedule"), (.manual, "Manual")])

      if draft.triggerKind == .schedule {
        ThemedTextField(
          placeholder: "0 9 * * 1-5",
          text: Binding(get: { draft.cron ?? "" }, set: { draft.cron = $0 }),
          mono: true)
        ThemedTextField(
          placeholder: TimeZone.current.identifier,
          text: Binding(get: { draft.timezone ?? "" }, set: { draft.timezone = $0 }))
        Toggle("Catch up after the computer was asleep", isOn: $draft.catchUp)
          .font(.system(size: 14))
          .tint(theme.accent)
      }
    }
  }

  private var scope: some View {
    Field(label: "SCOPE", caption: "Repos the run may read, and what feeds it work.") {
      Btn(label: projectsLabel, tone: .secondary, small: true) { sheet = .projects }
      Btn(label: sourcesLabel, tone: .secondary, small: true) { sheet = .sources }
    }
  }

  private var behaviour: some View {
    Field(
      label: "BEHAVIOUR",
      caption: "Autonomy is a ceiling request — the computer takes the lowest of this, "
        + "its own default and the project's cap."
    ) {
      Btn(
        label: "Autonomy: \(draft.autonomy?.label ?? "inherit")", tone: .secondary, small: true
      ) { sheet = .autonomy }
      ThemedTextField(
        placeholder: "Model — blank uses the default",
        text: Binding(get: { draft.model ?? "" }, set: { draft.model = $0.isEmpty ? nil : $0 }),
        mono: true)
      GuardrailFields(guardrails: $draft.guardrails)
    }
  }

  private var playbook: some View {
    Field(label: "PLAYBOOK", caption: "Markdown instructions handed to the run's agent.") {
      ThemedTextField(
        placeholder: "What should this run do?", text: $draft.playbook,
        multiline: true, lines: 6...24, mono: true)
    }
  }

  // MARK: Sheets

  @ViewBuilder
  private func sheetContent(_ which: Sheet) -> some View {
    switch which {
    case .projects:
      PickerSheet(
        title: "Projects",
        options: app.projects.map { .init(value: $0.repoRoot, label: $0.name, hint: $0.repoRoot) },
        selected: Set(draft.repoRoots),
        multi: true,
        emptyMessage: "This computer has no projects registered."
      ) { value in
        toggle(value, in: \.repoRoots)
      }
    case .sources:
      PickerSheet(
        title: "Signal sources",
        options: store.sources.map {
          .init(
            value: $0.id, label: $0.label,
            hint: $0.available ? $0.mode.rawValue : "\($0.mode.rawValue) · not configured")
        },
        selected: Set(draft.sourceIds),
        multi: true,
        emptyMessage: "This computer reported no signal sources."
      ) { value in
        toggle(value, in: \.sourceIds)
      }
    case .autonomy:
      PickerSheet(
        title: "Autonomy",
        options: [.init(value: "inherit", label: "Inherit", hint: "Use the computer's default")]
          + RemoteAutonomy.allRungs.map {
            .init(value: $0.rawValue, label: $0.label, hint: $0.caption)
          },
        selected: [draft.autonomy?.rawValue ?? "inherit"]
      ) { value in
        draft.autonomy = RemoteAutonomy(rawValue: value)
      }
    }
  }

  private func toggle(_ value: String, in path: WritableKeyPath<RemoteAutomationDetail, [String]>) {
    if let index = draft[keyPath: path].firstIndex(of: value) {
      draft[keyPath: path].remove(at: index)
    } else {
      draft[keyPath: path].append(value)
    }
  }

  private var projectsLabel: String {
    draft.repoRoots.isEmpty
      ? "Projects: none"
      : "Projects: \(draft.repoRoots.map { ($0 as NSString).lastPathComponent }.joined(separator: ", "))"
  }

  private var sourcesLabel: String {
    guard !draft.sourceIds.isEmpty else { return "Signal sources: none" }
    let labels = draft.sourceIds.map { id in
      store.sources.first { $0.id == id }?.label ?? id
    }

    return "Sources: \(labels.joined(separator: ", "))"
  }

  // MARK: Actions

  private func load() async {
    await store.loadSources()
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
