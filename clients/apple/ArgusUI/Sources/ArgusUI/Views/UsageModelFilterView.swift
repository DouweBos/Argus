import ArgusCore
import SwiftUI

/// "Counted models": the models Usage counts only and the ones it leaves out,
/// a card per list. Every change saves at once, as the Mac's Settings list does.
public struct HostUsageModelFilterView: View {
  @Environment(HostStore.self) private var host
  @Environment(\.theme) private var theme
  let canEdit: Bool
  @State private var error: String?

  public init(canEdit: Bool = true) {
    self.canEdit = canEdit
  }

  private var runners: [UsageModelRunnerOption] {
    host.runners.map { .init(id: $0.id, name: $0.displayName) }
  }

  public var body: some View {
    Group {
      if let filter = host.usageModelFilter {
        editor(filter)
      } else if let failure = host.usageModelFilterError {
        EmptyState(icon: Icon.warning, title: "Couldn't load counted models", body: failure, selectable: true) {
          Btn(label: "Retry", tone: .secondary, small: true, icon: Icon.refresh) { Task { await load() } }.fixedSize()
        }
      } else {
        Loading(label: "Loading counted models…").frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .background(theme.bg.ignoresSafeArea())
    .task(id: host.connection == .ready) {
      guard host.connection == .ready else { return }
      await load()
    }
  }

  private func load() async {
    await host.loadRunners()
    await host.loadUsageModelFilter()
  }

  private func editor(_ filter: ArgusProtocol.UsageModelFilter) -> some View {
    Screen {
      if let error {
        Banner(text: error, tone: .danger)
      }
      if !canEdit {
        Text("Viewing only: this device can't change which models count.")
          .font(.scaled(size: 13))
          .foregroundStyle(theme.textMuted)
      }
      ForEach(UsageModelFilterList.allCases, id: \.self) { list in
        VStack(alignment: .leading, spacing: 6) {
          SectionHeader(title: list.title, count: filter[list].isEmpty ? nil : filter[list].count)
          Card { rows(list, filter) }
          Text(list.footer)
            .font(.scaled(size: 12))
            .foregroundStyle(theme.textMuted)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
    }
  }

  @ViewBuilder
  private func rows(_ list: UsageModelFilterList, _ filter: ArgusProtocol.UsageModelFilter) -> some View {
    ForEach(Array(filter[list].enumerated()), id: \.offset) { index, rule in
      UsageModelRuleRow(rule: rule, runners: runners, canEdit: canEdit) { next in
        save(filter.changing(index, in: list, to: next))
      }
      if canEdit || index < filter[list].count - 1 { Divider().overlay(theme.borderSubtle) }
    }
    if canEdit {
      UsageModelRuleDraft(runners: runners) { rule in
        guard let next = filter.adding(rule, to: list) else { return }
        save(next)
      }
    } else if filter[list].isEmpty {
      Text(list == .include ? "Every model counts." : "No model is left out.")
        .font(.scaled(size: 13))
        .foregroundStyle(theme.textMuted)
    }
  }

  private func save(_ next: ArgusProtocol.UsageModelFilter) {
    Task { error = await host.saveUsageModelFilter(next) }
  }
}
