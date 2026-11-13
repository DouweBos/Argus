import ArgusCore
import SwiftUI

/// A runner a model rule can be scoped to.
public struct UsageModelRunnerOption: Hashable, Sendable {
  public var id: String
  public var name: String

  public init(id: String, name: String) {
    self.id = id
    self.name = name
  }
}

/// The runner a rule is scoped to: Any, or one of the host's runners. A native
/// picker on the Mac, a menu chip on the phone.
struct UsageModelRunnerPicker: View {
  @Binding var runner: String?
  let runners: [UsageModelRunnerOption]

  /// A rule for a runner since removed keeps its id rather than reading as Any.
  private var options: [UsageModelRunnerOption] {
    guard let runner, !runners.contains(where: { $0.id == runner }) else { return runners }
    return runners + [.init(id: runner, name: runner)]
  }

  var body: some View {
    #if os(macOS)
      Picker("Runner", selection: $runner) {
        Text("Any runner").tag(String?.none)
        ForEach(options, id: \.id) { Text($0.name).tag(Optional($0.id)) }
      }
      .labelsHidden()
      .fixedSize()
    #else
      MenuChip(
        "Runner", selection: $runner,
        options: [.init(value: nil, label: "Any runner")] + options.map { .init(value: Optional($0.id), label: $0.name) },
        icon: Icon.terminal)
    #endif
  }
}

/// One saved rule: its model id, the runner it applies to, and Remove.
public struct UsageModelRuleRow: View {
  @Environment(\.theme) private var theme
  let rule: ArgusProtocol.UsageModelRule
  let runners: [UsageModelRunnerOption]
  let canEdit: Bool
  /// Nil removes the rule.
  let change: (ArgusProtocol.UsageModelRule?) -> Void

  public init(
    rule: ArgusProtocol.UsageModelRule, runners: [UsageModelRunnerOption], canEdit: Bool = true,
    change: @escaping (ArgusProtocol.UsageModelRule?) -> Void
  ) {
    self.rule = rule
    self.runners = runners
    self.canEdit = canEdit
    self.change = change
  }

  public var body: some View {
    HStack(spacing: 8) {
      Image(systemName: Icon.usage).foregroundStyle(.secondary).accessibilityHidden(true)
      Text(rule.model).font(.scaled(.body).monospaced()).lineLimit(1).truncationMode(.middle)
      Spacer(minLength: 8)
      UsageModelRunnerPicker(
        runner: Binding(get: { rule.runner }, set: { change(.init(runner: $0, model: rule.model)) }),
        runners: runners
      )
      .disabled(!canEdit)
      if canEdit {
        Button("Remove", systemImage: "xmark.circle.fill") { change(nil) }
          .labelStyle(.iconOnly)
          .buttonStyle(.argusBorderless)
          .foregroundStyle(theme.textMuted)
          .help("Remove \(rule.model)")
      }
    }
  }
}

/// The add row under a list: a model id, its runner, and Add. Stacked on the
/// phone, where the three don't fit one line.
public struct UsageModelRuleDraft: View {
  @Environment(\.theme) private var theme
  let runners: [UsageModelRunnerOption]
  let add: (ArgusProtocol.UsageModelRule) -> Void
  @State private var model = ""
  @State private var runner: String?

  public init(runners: [UsageModelRunnerOption], add: @escaping (ArgusProtocol.UsageModelRule) -> Void) {
    self.runners = runners
    self.add = add
  }

  private var trimmed: String { model.trimmingCharacters(in: .whitespacesAndNewlines) }

  public var body: some View {
    #if os(macOS)
      HStack(spacing: 8) {
        TextField("Model", text: $model, prompt: Text("Model id, e.g. claude-haiku-4-5"))
          .labelsHidden()
          .font(.scaled(.body).monospaced())
          .onSubmit(commit)
        UsageModelRunnerPicker(runner: $runner, runners: runners)
        Button("Add", action: commit).disabled(trimmed.isEmpty)
      }
    #else
      VStack(alignment: .leading, spacing: 8) {
        ThemedTextField(
          placeholder: "Model id, e.g. claude-haiku-4-5", text: $model, mono: true, input: .code, onSubmit: commit)
        HStack(spacing: 8) {
          UsageModelRunnerPicker(runner: $runner, runners: runners)
          Spacer(minLength: 0)
          Btn(label: "Add", tone: .secondary, small: true, icon: Icon.plus, hugs: true, action: commit)
            .disabled(trimmed.isEmpty)
        }
      }
    #endif
  }

  private func commit() {
    guard !trimmed.isEmpty else { return }
    add(.init(runner: runner, model: trimmed))
    model = ""
  }
}
