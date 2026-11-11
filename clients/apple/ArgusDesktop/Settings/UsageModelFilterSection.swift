import ArgusCore
import ArgusUI
import SwiftUI

/// Which models Usage counts (`usage_model_filter`): a list to count only,
/// and a list to leave out, each rule a model id on one runner or any.
struct UsageModelFilterSection: View {
  enum Kind: CaseIterable {
    case include, exclude

    var title: String { self == .include ? "Usage: count only these models" : "Usage: leave out these models" }

    var footer: String {
      switch self {
      case .include:
        "With any model here, Usage's cost and tokens count only these. Empty counts every model."
      case .exclude: "Usage's cost and tokens never count these models."
      }
    }
  }

  @Environment(HostSettingsModel.self) private var host

  private var filter: ArgusProtocol.UsageModelFilter {
    host.settings?.usageModelFilter ?? .init(include: [], exclude: [])
  }

  var body: some View {
    ForEach(Kind.allCases, id: \.self) { kind in
      SettingsGroup(kind.title, footer: kind.footer) {
        if host.settings == nil {
          SettingsLoading()
        } else {
          ForEach(Array(rules(kind).enumerated()), id: \.offset) { index, rule in
            UsageModelRuleRow(rule: rule, runners: host.runners) { next in
              var list = rules(kind)
              if let next { list[index] = next } else { list.remove(at: index) }
              write(kind, list)
            }
          }
          UsageModelRuleDraft(runners: host.runners) { rule in
            guard !rules(kind).contains(where: { $0.model == rule.model && $0.runner == rule.runner }) else { return }
            write(kind, rules(kind) + [rule])
          }
        }
      }
    }
  }

  private func rules(_ kind: Kind) -> [ArgusProtocol.UsageModelRule] {
    kind == .include ? filter.include : filter.exclude
  }

  private func write(_ kind: Kind, _ list: [ArgusProtocol.UsageModelRule]) {
    var next = filter
    if kind == .include { next.include = list } else { next.exclude = list }
    let cleared = next.include.isEmpty && next.exclude.isEmpty
    let value: JSONValue =
      cleared
      ? .null
      : .object(["include": Self.json(next.include), "exclude": Self.json(next.exclude)])
    Task {
      await host.save(.usageModelFilter, ["usage_model_filter": value]) {
        $0.usageModelFilter = cleared ? nil : next
      }
    }
  }

  private static func json(_ rules: [ArgusProtocol.UsageModelRule]) -> JSONValue {
    .array(rules.map { .object(["runner": $0.runner.map(JSONValue.string) ?? .null, "model": .string($0.model)]) })
  }
}

/// The runner a rule is scoped to: Any, or one of the host's runners.
private struct RunnerPicker: View {
  @Binding var runner: String?
  let runners: [ArgusProtocol.RegisteredRunner]

  var body: some View {
    Picker("Runner", selection: $runner) {
      Text("Any runner").tag(String?.none)
      ForEach(runners, id: \.id) { Text($0.displayName).tag(Optional($0.id)) }
      // A rule for a runner since removed keeps its id rather than reading as Any.
      if let runner, !runners.contains(where: { $0.id == runner }) {
        Text(runner).tag(Optional(runner))
      }
    }
    .labelsHidden()
    .fixedSize()
  }
}

/// One saved rule: its model id, the runner it applies to, and Remove.
private struct UsageModelRuleRow: View {
  let rule: ArgusProtocol.UsageModelRule
  let runners: [ArgusProtocol.RegisteredRunner]
  /// Nil removes the rule.
  let change: (ArgusProtocol.UsageModelRule?) -> Void

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: Icon.usage).foregroundStyle(.secondary).accessibilityHidden(true)
      Text(rule.model).font(.scaled(.body).monospaced()).lineLimit(1).truncationMode(.middle)
      Spacer(minLength: 8)
      RunnerPicker(
        runner: Binding(get: { rule.runner }, set: { change(.init(runner: $0, model: rule.model)) }),
        runners: runners)
      Button("Remove", systemImage: "xmark.circle.fill") { change(nil) }
        .labelStyle(.iconOnly)
        .buttonStyle(.argusBorderless)
        .help("Remove \(rule.model)")
    }
  }
}

/// The add row under a list: a model id, its runner, and Add.
private struct UsageModelRuleDraft: View {
  let runners: [ArgusProtocol.RegisteredRunner]
  let add: (ArgusProtocol.UsageModelRule) -> Void
  @State private var model = ""
  @State private var runner: String?

  private var trimmed: String { model.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    HStack(spacing: 8) {
      TextField("Model", text: $model, prompt: Text("Model id, e.g. claude-haiku-4-5"))
        .labelsHidden()
        .font(.scaled(.body).monospaced())
        .onSubmit(commit)
      RunnerPicker(runner: $runner, runners: runners)
      Button("Add", action: commit).disabled(trimmed.isEmpty)
    }
  }

  private func commit() {
    guard !trimmed.isEmpty else { return }
    add(.init(runner: runner, model: trimmed))
    model = ""
  }
}
