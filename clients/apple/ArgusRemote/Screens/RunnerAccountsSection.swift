import ArgusCore
import ArgusUI
import SwiftUI

/// Every runner besides Claude Code, as the computer's CLIs report it. Read
/// only: installing and signing in run in a terminal on the computer.
struct RunnerAccountsSection: View {
  @Environment(HostStore.self) private var host

  var body: some View {
    let sections = RunnerAccountSections(host.runnerAccounts ?? [])
    if !sections.installed.isEmpty || !sections.missing.isEmpty {
      Section {
        ForEach(sections.installed) { RunnerAccountRow(account: $0) }
        if sections.collapsesMissing {
          DisclosureGroup("Not installed (\(sections.missing.count))") {
            ForEach(sections.missing) { RunnerAccountRow(account: $0) }
          }
        } else {
          ForEach(sections.missing) { RunnerAccountRow(account: $0) }
        }
      } header: {
        Text("Other runners")
      } footer: {
        Text("Install, sign in or sign out in Settings → Accounts on your computer.")
      }
    }
  }
}

private struct RunnerAccountRow: View {
  let account: ArgusProtocol.RunnerAccount
  @Environment(\.theme) private var theme

  var body: some View {
    HStack(spacing: theme.space) {
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 6) {
          Text(account.displayName)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(theme.text)
          if account.isCustom { Badge(label: "Custom", tone: .muted) }
        }
        if let detail = account.account {
          Text(detail).font(.footnote).foregroundStyle(theme.textSecondary)
        }
      }
      Spacer(minLength: theme.space)
      Badge(label: account.statusLabel, tone: tone)
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
  }

  private var tone: Tone {
    switch account.tone {
    case .success: .success
    case .warning: .warning
    case .muted: .muted
    }
  }
}
