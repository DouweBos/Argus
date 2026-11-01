import ArgusUI
import SwiftUI

/// Which computer this is, labelled, and the way to another. Home and the
/// iPad sidebar both lead with it.
struct ComputerSwitcher: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(\.dynamicTypeSize) private var typeSize

  private var name: String { app.identity?.label ?? "No computer" }

  var body: some View {
    row
      .accessibilityHidden(true)
      // iOS 26's menu morph hides its label while open; a clear label keeps the card on screen.
      .overlay {
        Menu {
          Picker("Computer", selection: hostSelection) {
            ForEach(app.hosts) { host in
              Text(host.label).tag(host.deviceId as String?)
            }
          }
          Divider()
          Button("Pair a computer…", systemImage: Icon.plus) { router.push(.pair) }
          Button("Manage computers…", systemImage: Icon.desktop) { router.push(.computers) }
        } label: {
          Color.clear.contentShape(.rect)
        }
        .accessibilityLabel("Computer, \(name), \(host.connection.label)")
        .accessibilityHint("Switches computers")
      }
  }

  private var row: some View {
    HStack(spacing: 12) {
      // At accessibility sizes the name needs the width more than the glyph does.
      if !typeSize.isAccessibilitySize {
        Image(systemName: Icon.desktop)
          .font(.scaled(size: 18))
          .foregroundStyle(theme.accent)
          .frame(width: 28)
      }
      // The status sits on the label line so a long computer name gets the full width.
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 6) {
          Text("Computer")
          StatusDot(tone: host.connection.tone, pulse: host.connection != .ready)
          Text(host.connection.label)
        }
        .font(.scaled(.caption)).foregroundStyle(theme.textSecondary)
        .lineLimit(1)
        Text(name).font(.scaled(size: 16, weight: .semibold)).foregroundStyle(theme.text)
          .lineLimit(2)
      }
      Spacer(minLength: 8)
      Image(systemName: Icon.chevronUpDown).font(.scaled(.caption)).foregroundStyle(theme.textMuted)
    }
  }

  private var hostSelection: Binding<String?> {
    Binding(
      get: { app.activeHostId },
      set: { id in
        guard let id else { return }
        Task { await app.selectHost(id) }
      })
  }
}

/// What Argus is waiting on you for — the inbox's actionable half, as the
/// Mac's home leads with it.
struct HomeNeedsYouSection: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(ProposalsStore.self) private var proposals
  @Environment(AutomationsStore.self) private var automations

  var body: some View {
    let needs = proposals.items(runs: automations.runs, sessionIds: []).needsYou()
    if needs.waiting > 0 {
      Section {
        ForEach(needs.proposals) { proposal in
          NavigationLink(value: Route.proposal(id: proposal.id)) {
            row(icon: Icon.proposal, tint: theme.accent, title: proposal.title, detail: proposal.summary)
          }
        }
        ForEach(needs.failed) { run in
          NavigationLink(value: Route.run(id: run.id, label: run.automationName)) {
            row(
              icon: Icon.warning, tint: theme.error, title: run.automationName,
              detail: run.error ?? run.triggerReason)
          }
        }
        if needs.hidden > 0 {
          Button("\(needs.hidden) more in the inbox") { followHomeLink(.inbox) { router.show(.inbox) } }
        }
      } header: {
        HomeSectionHeader(title: "Needs you", note: "\(needs.waiting) waiting")
      }
    }
  }

  private func row(icon: String, tint: Color, title: String, detail: String) -> some View {
    HStack(spacing: 10) {
      Image(systemName: icon).foregroundStyle(tint).frame(width: 20)
      VStack(alignment: .leading, spacing: 2) {
        Text(title).fontWeight(.medium).lineLimit(1)
        Text(detail).font(.scaled(.footnote)).foregroundStyle(theme.textSecondary).lineLimit(2)
      }
    }
  }
}

/// The newest automation runs, unread reports first — they happen while
/// nobody is looking, so home is where you find out they did.
struct HomeRecentRunsSection: View {
  @Environment(\.theme) private var theme
  @Environment(Router.self) private var router
  @Environment(AutomationsStore.self) private var automations

  private static let limit = 5

  var body: some View {
    let runs = automations.runs
      .sorted { $0.hasUnreadReport != $1.hasUnreadReport ? $0.hasUnreadReport : $0.startedAt > $1.startedAt }
    let unread = runs.count { $0.hasUnreadReport }
    if !runs.isEmpty {
      Section {
        ForEach(runs.prefix(Self.limit)) { run in
          NavigationLink(value: Route.run(id: run.id, label: run.isQuick ? "Quick run" : run.automationName)) {
            HStack(spacing: 8) {
              Circle().fill(run.hasUnreadReport ? theme.accent : .clear).frame(width: 6, height: 6)
              Badge(label: run.status.rawValue, tone: run.status.tone)
              Text(run.isQuick ? "Quick run" : run.automationName).lineLimit(1)
              Spacer(minLength: 4)
              Text(Labels.timeAgo(run.startedAt)).font(.scaled(.caption)).foregroundStyle(theme.textMuted)
            }
          }
        }
      } header: {
        HomeSectionHeader(
          title: "Recent runs", note: unread > 0 ? "\(unread) new report\(unread == 1 ? "" : "s")" : nil,
          action: ("View all", { followHomeLink(.automations) { router.show(.automations) } }))
      }
    }
  }
}

/// Follow one of Home's links, counting which.
@MainActor
func followHomeLink(_ action: TelemetryEvent.HomeAction, _ go: () -> Void) {
  Telemetry.capture(.homeUsed(action: action))
  go()
}

/// A section header with an optional count and a trailing link, as the Mac's
/// `HomeSection` draws them.
struct HomeSectionHeader: View {
  @Environment(\.theme) private var theme
  let title: String
  var note: String?
  var action: (label: String, run: () -> Void)?

  var body: some View {
    HStack(spacing: 8) {
      Text(title)
      if let note {
        Text(note).foregroundStyle(theme.warning)
      }
      Spacer(minLength: 4)
      if let action {
        Button(action.label, action: action.run)
          .font(.scaled(.footnote))
          .textCase(nil)
      }
    }
  }
}
