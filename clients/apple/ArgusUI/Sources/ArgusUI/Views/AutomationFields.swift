import ArgusCore
import SwiftUI

/// The fields an automation and a quick run share: what it does, what it may
/// read, how far it may go, and the playbook itself.
///
/// A quick run is a playbook run once, so it hides the trigger and the enabled
/// switch — everything else is the same form, because it is the same spec.
public struct AutomationFields: View {
  private enum Sheet: String, Identifiable {
    case projects, sources, autonomy, runner, model
    var id: String { rawValue }
  }

  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host

  @Binding var draft: RemoteAutomationDetail
  var showsSchedule = true
  let sources: [RemoteSignalSource]
  /// Empty on a host too old to answer `automations.runners`.
  var runners: [RemoteRunner] = []

  @State private var sheet: Sheet?
  @State private var revising = false

  public init(
    draft: Binding<RemoteAutomationDetail>,
    showsSchedule: Bool = true,
    sources: [RemoteSignalSource],
    runners: [RemoteRunner] = []
  ) {
    self._draft = draft
    self.showsSchedule = showsSchedule
    self.sources = sources
    self.runners = runners
  }

  public var body: some View {
    basics
    if showsSchedule { trigger }
    scope
    behaviour
    playbook
    // Nil means the computer is too old to keep them, so don't offer the field.
    if showsSchedule, draft.extraInstructions != nil { extraInstructions }
  }

  private var basics: some View {
    Field(label: "BASICS") {
      ThemedTextField(placeholder: "Name", text: $draft.name, input: .name)
      if showsSchedule {
        ThemedTextField(placeholder: "What it does", text: $draft.description, multiline: true)
        Toggle("Enabled", isOn: $draft.enabled)
          .font(.scaled(size: 15))
          .tint(theme.tint)
      }
    }
    .sheet(item: $sheet) { which in sheetContent(which) }
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
          mono: true, input: .code)
        ThemedTextField(
          placeholder: TimeZone.current.identifier,
          text: Binding(get: { draft.timezone ?? "" }, set: { draft.timezone = $0 }),
          input: .code)
        if let preview = draft.schedulePreviewText() { schedulePreview(preview) }
        Toggle("Catch up after the computer was asleep", isOn: $draft.catchUp)
          .font(.scaled(size: 14))
          .tint(theme.tint)
      }
    }
  }

  private func schedulePreview(_ preview: SchedulePreviewText) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      if let error = preview.error {
        Text(error).font(.scaled(size: 13)).foregroundStyle(theme.error)
      } else {
        if let headline = preview.headline { BodyText(headline) }
        ForEach(preview.runs, id: \.self) { MutedText($0).monospacedDigit() }
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
      if !runners.isEmpty {
        Btn(label: "Runner: \(runnerLabel)", tone: .secondary, small: true) { sheet = .runner }
      }
      // A runner that declares its models gets a picker; Claude Code only
      // learns its list from a live handshake, so there it stays free text.
      if declaredModels.isEmpty {
        ThemedTextField(
          placeholder: "Model — blank uses the default",
          text: Binding(get: { draft.model ?? "" }, set: { draft.model = $0.isEmpty ? nil : $0 }),
          mono: true, input: .code)
      } else {
        Btn(label: "Model: \(modelLabel)", tone: .secondary, small: true) { sheet = .model }
      }
      GuardrailFields(guardrails: $draft.guardrails)
    }
  }

  private var playbook: some View {
    Field(label: "PLAYBOOK", caption: "Markdown instructions handed to the run's agent.") {
      ThemedTextField(
        placeholder: "What should this run do?", text: $draft.playbook,
        multiline: true, lines: 6...24, mono: true)
      if host.hasControl {
        Btn(label: "Rewrite with Claude", tone: .secondary, small: true) { revising = true }
          .disabled(draft.playbook.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
    }
    .sheet(isPresented: $revising) {
      RevisePlaybookSheet(playbook: draft.playbook, name: draft.name) { rewritten in
        draft.playbook = rewritten
      }
    }
  }

  private var extraInstructions: some View {
    Field(
      label: "EXTRA INSTRUCTIONS",
      caption: "Added after the playbook on every run; they win where the two disagree."
    ) {
      ThemedTextField(
        placeholder: "Skip anything labelled needs-design.",
        text: Binding(
          get: { draft.extraInstructions ?? "" }, set: { draft.extraInstructions = $0 }),
        multiline: true, lines: 3...12, mono: true)
    }
  }

  @ViewBuilder
  private func sheetContent(_ which: Sheet) -> some View {
    switch which {
    case .projects:
      PickerSheet(
        title: "Projects",
        options: host.projects.map { .init(value: $0.repoRoot, label: $0.name, hint: $0.repoRoot) },
        selected: Set(draft.repoRoots),
        multi: true,
        emptyMessage: "This computer has no projects registered."
      ) { value in
        toggle(value, in: \.repoRoots)
      }
    case .sources:
      PickerSheet(
        title: "Signal sources",
        options: sources.map {
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
    case .runner:
      PickerSheet(
        title: "Runner",
        options: [.init(value: "", label: "Default", hint: "Use the computer's default")]
          + runners.map {
            .init(value: $0.id, label: $0.displayName, hint: $0.isCustom ? "custom" : nil)
          },
        selected: [draft.runner ?? ""]
      ) { value in
        draft.runner = value.isEmpty ? nil : value
        // Model ids don't carry across runners, so a switch drops the model.
        draft.model = nil
      }
    case .model:
      PickerSheet(
        title: "Model",
        options: [.init(value: "", label: "Default", hint: "Use the runner's default")]
          + declaredModels.map {
            .init(value: $0.value, label: $0.displayName, hint: $0.description)
          },
        selected: [draft.model ?? ""]
      ) { value in
        draft.model = value.isEmpty ? nil : value
      }
    }
  }

  private var selectedRunner: RemoteRunner? {
    draft.runner.flatMap { id in runners.first { $0.id == id } }
  }

  private var declaredModels: [RemoteRunner.Model] { selectedRunner?.models ?? [] }

  private var runnerLabel: String {
    selectedRunner?.displayName ?? draft.runner ?? "default"
  }

  private var modelLabel: String {
    guard let model = draft.model else { return "default" }

    return declaredModels.first { $0.value == model }?.displayName ?? model
  }

  private func toggle(_ value: String, in path: WritableKeyPath<RemoteAutomationDetail, [String]>) {
    if let index = draft[keyPath: path].firstIndex(of: value) {
      draft[keyPath: path].remove(at: index)
    } else {
      draft[keyPath: path].append(value)
    }
  }

  private var projectsLabel: String {
    guard !draft.repoRoots.isEmpty else { return "Projects: none" }
    let names = draft.repoRoots.map { ($0 as NSString).lastPathComponent }

    return "Projects: \(names.joined(separator: ", "))"
  }

  private var sourcesLabel: String {
    guard !draft.sourceIds.isEmpty else { return "Signal sources: none" }
    let labels = draft.sourceIds.map { id in
      sources.first { $0.id == id }?.label ?? id
    }

    return "Sources: \(labels.joined(separator: ", "))"
  }
}
