import ArgusCore
import ArgusUI
import SwiftUI

/// Which models Usage counts (`usage_model_filter`): a list to count only,
/// and a list to leave out, each rule a model id on one runner or any.
struct UsageModelFilterSection: View {
  @Environment(HostSettingsModel.self) private var host

  private var filter: ArgusProtocol.UsageModelFilter {
    host.settings?.usageModelFilter ?? .empty
  }

  private var runners: [UsageModelRunnerOption] {
    host.runners.map { .init(id: $0.id, name: $0.displayName) }
  }

  var body: some View {
    ForEach(UsageModelFilterList.allCases, id: \.self) { list in
      SettingsGroup("Usage: " + list.title.lowercased(), footer: list.footer) {
        if host.settings == nil {
          SettingsLoading()
        } else {
          ForEach(Array(filter[list].enumerated()), id: \.offset) { index, rule in
            UsageModelRuleRow(rule: rule, runners: runners) { next in
              write(filter.changing(index, in: list, to: next))
            }
          }
          UsageModelRuleDraft(runners: runners) { rule in
            if let next = filter.adding(rule, to: list) { write(next) }
          }
        }
      }
    }
  }

  private func write(_ next: ArgusProtocol.UsageModelFilter) {
    let saved = next.orNil
    let value: JSONValue =
      saved == nil
      ? .null
      : .object(["include": Self.json(next.include), "exclude": Self.json(next.exclude)])
    Task {
      await host.save(.usageModelFilter, ["usage_model_filter": value]) { $0.usageModelFilter = saved }
    }
  }

  private static func json(_ rules: [ArgusProtocol.UsageModelRule]) -> JSONValue {
    .array(rules.map { .object(["runner": $0.runner.map(JSONValue.string) ?? .null, "model": .string($0.model)]) })
  }
}
