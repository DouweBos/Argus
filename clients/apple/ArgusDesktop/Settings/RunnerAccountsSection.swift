import ArgusCore
import ArgusUI
import SwiftUI

/// Every runner besides Claude Code: installed, signed in and as whom, with the
/// same Install / Sign In terminal the runner picker opens.
struct RunnerAccountsSection: View {
  @Environment(HostStore.self) private var store
  @Environment(DesktopModel.self) private var model
  @State private var checking: Set<String> = []
  @State private var showsMissing = false

  private var sections: RunnerAccountSections { RunnerAccountSections(store.runnerAccounts ?? []) }

  var body: some View {
    SettingsGroup(
      "Other runners",
      footer: "Install and Sign In run the runner's own command in a terminal, as the runner picker does. "
        + "Argus asks each CLI who it's signed in as; some can't say, so their status stays unknown."
    ) {
      if store.runnerAccounts == nil {
        SettingsLoading()
      } else if sections.installed.isEmpty && sections.missing.isEmpty {
        Text("No other runners.").foregroundStyle(.secondary)
      }
      ForEach(sections.installed) { row($0) }
      if sections.collapsesMissing {
        MissingRunnersToggle(count: sections.missing.count, expanded: $showsMissing)
        if showsMissing { ForEach(sections.missing) { row($0) } }
      } else {
        ForEach(sections.missing) { row($0) }
      }
    }
    .task { await store.refreshRunnerAccounts() }
    .onChange(of: model.runnerSetup.revision) { Task { await store.refreshRunnerAccounts() } }
  }

  private func row(_ account: ArgusProtocol.RunnerAccount) -> some View {
    RunnerAccountRow(account: account, checking: checking.contains(account.id)) { perform($0, on: account) }
  }

  private func perform(_ action: ArgusProtocol.RunnerAccount.Action, on account: ArgusProtocol.RunnerAccount) {
    switch action {
    case .install: model.runnerSetup.begin(RunnerSetupFlow(account, step: .install), in: .settings)
    case .signIn: model.runnerSetup.begin(RunnerSetupFlow(account, step: .login), in: .settings)
    case .signOut: model.runnerSetup.begin(RunnerSetupFlow(account, step: .logout), in: .settings)
    case .checkAgain:
      checking.insert(account.id)
      Task {
        await store.checkRunnerAccount(id: account.id)
        checking.remove(account.id)
      }
    }
  }
}

/// "Not installed · 5", folding the runners that aren't on this computer.
private struct MissingRunnersToggle: View {
  let count: Int
  @Binding var expanded: Bool

  var body: some View {
    Button {
      withAnimation(.snappy) { expanded.toggle() }
    } label: {
      HStack(spacing: 6) {
        Image(systemName: "chevron.right")
          .font(.scaled(size: 10, weight: .semibold))
          .rotationEffect(.degrees(expanded ? 90 : 0))
        Text("Not installed").foregroundStyle(.secondary)
        Text("\(count)").font(.scaled(.caption)).foregroundStyle(.tertiary)
        Spacer(minLength: 0)
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.argusPlain)
    .accessibilityLabel(expanded ? "Hide runners that aren't installed" : "Show runners that aren't installed")
  }
}

private struct RunnerAccountRow: View {
  @Environment(\.theme) private var theme
  let account: ArgusProtocol.RunnerAccount
  let checking: Bool
  let perform: (ArgusProtocol.RunnerAccount.Action) -> Void

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: symbol)
        .foregroundStyle(color)
        .frame(width: 16)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 6) {
          Text(account.displayName)
          if account.isCustom {
            Text("Custom").font(.scaled(.caption)).foregroundStyle(.secondary)
          }
        }
        Text(account.subtitle).font(.scaled(.caption)).foregroundStyle(subtitleColor)
      }
      Spacer()
      if checking {
        ProgressView().controlSize(.small)
      } else if let primary = account.primaryAction {
        Button(primary.title) { perform(primary) }
      }
      Menu {
        ForEach(account.actions.filter { $0 != account.primaryAction }, id: \.self) { action in
          Button(action.title + (action == .install || action == .signIn ? "…" : "")) { perform(action) }
        }
      } label: {
        Image(systemName: "ellipsis")
      }
      .menuStyle(.borderlessButton)
      .clickable()
      .fixedSize()
      .disabled(checking)
      .accessibilityLabel("\(account.displayName) actions")
    }
    .help(account.detail ?? "")
  }

  private var symbol: String {
    switch account.status {
    case .signedIn: "checkmark.circle.fill"
    case .signedOut: "exclamationmark.circle"
    case .notInstalled: "arrow.down.circle"
    default: "questionmark.circle"
    }
  }

  private var color: Color {
    switch account.tone {
    case .success: theme.success
    case .warning: theme.warning
    case .muted: theme.textMuted
    }
  }

  private var subtitleColor: Color { account.status == .signedOut ? theme.warning : theme.textSecondary }
}
