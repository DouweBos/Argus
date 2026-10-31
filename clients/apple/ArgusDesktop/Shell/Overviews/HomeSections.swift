import ArgusCore
import ArgusUI
import SwiftUI
import UserNotifications

/// The cards Electron's home adds past the core checks: notifications that
/// are off, and tools a project might need that aren't installed. Plus one
/// only this app needs: secrets the Electron app hasn't moved over yet.
struct HomeEnvironmentCards: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @AppStorage("home.notificationsCardDismissed") private var notificationsDismissed = false
  @State private var notifications: UNAuthorizationStatus?
  @State private var asking = false
  @State private var missing: [ArgusProtocol.DependencyStatus] = []
  @State private var legacySecrets: [ArgusProtocol.SecretStoreId] = []

  /// Covered by the core checks above.
  private static let coveredByChecks: Set<String> = ["claude", "git"]

  var body: some View {
    VStack(spacing: 8) {
      if !legacySecrets.isEmpty {
        legacySecretsCard
      }
      if !notificationsDismissed, let status = notifications, status != .authorized, status != .provisional {
        notificationsCard(denied: status == .denied)
      }
      ForEach(missing, id: \.id) { dependency in
        SetupCard(
          tone: dependency.severity == .required ? .danger : .warning,
          title: "\(dependency.name) not found.",
          text: [dependency.purpose, dependency.hint].filter { !$0.isEmpty }.joined(separator: " ")
        ) {
          EmptyView()
        }
      }
    }
    .task { await refreshNotifications() }
    .task(id: store.connection == .ready) {
      guard store.connection == .ready, let backend = model.localBackend else { return }
      let report = try? await backend.request(ArgusProtocol.Commands.CheckDependencies.self, EmptyParams())
      missing = (report?.dependencies ?? []).filter { !$0.installed && !Self.coveredByChecks.contains($0.id) }
      legacySecrets = await fetchLegacySecrets() ?? []
    }
  }

  private func fetchLegacySecrets() async -> [ArgusProtocol.SecretStoreId]? {
    guard let backend = model.localBackend else { return nil }
    return try? await backend.request(ArgusProtocol.Commands.LegacySecretStores.self, EmptyParams())
  }

  /// Only the Electron app can read what its old keychain scheme sealed.
  private var legacySecretsCard: some View {
    let what = [
      legacySecrets.contains(.remoteDevices) ? "paired devices" : nil,
      legacySecrets.contains(.mcpTokens) ? "MCP sign-ins" : nil,
    ].compactMap(\.self).joined(separator: " and ")
    return SetupCard(
      tone: .warning,
      title: "Your \(what) are still in the Electron app's format.",
      text: "Quit Argus for Mac, open the Electron app once so it moves them over, quit it, then reopen this app."
    ) {
      Button("Check Again") {
        Task {
          legacySecrets = await fetchLegacySecrets() ?? legacySecrets
          MacTelemetry.capture(.homeCardActed(card: .legacySecrets, action: legacySecrets.isEmpty ? .fixed : .failed))
        }
      }
    }
  }

  private func notificationsCard(denied: Bool) -> some View {
    SetupCard(
      tone: .accent,
      title: denied ? "Notifications are blocked." : "Notifications are off.",
      text: denied
        ? "Enable them for Argus in System Settings to get pinged when agents need you."
        : "Turn them on to get pinged when an agent finishes a turn or asks for permission."
    ) {
      if denied {
        Button("Open System Settings") {
          if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") {
            NSWorkspace.shared.open(url)
          }
          MacTelemetry.capture(.homeCardActed(card: .notifications, action: .open))
        }
      } else {
        Button(asking ? "Asking…" : "Enable") { Task { await enable() } }
          .disabled(asking)
      }
      Button {
        notificationsDismissed = true
        MacTelemetry.capture(.homeCardActed(card: .notifications, action: .dismiss))
      } label: {
        Image(systemName: "xmark")
      }
      .buttonStyle(.argusBorderless)
      .accessibilityLabel("Dismiss")
    }
  }

  private func refreshNotifications() async {
    notifications = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
  }

  private func enable() async {
    asking = true
    let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    asking = false
    MacTelemetry.capture(.homeCardActed(card: .notifications, action: granted ? .fixed : .failed))
    await refreshNotifications()
  }
}

/// What Argus is waiting on you for — the inbox's actionable half, on home.
struct HomeNeedsYouSection: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store

  /// Enough to act on without home turning into the inbox.
  private static let maxProposals = 2
  private static let maxFailed = 2

  var body: some View {
    let needs = model.inbox.items(sessionIds: Set(store.sessionsByRepo.values.joined().map(\.id)))
      .needsYou(maxProposals: Self.maxProposals, maxFailed: Self.maxFailed)
    if needs.waiting > 0 {
      HomeSection(title: "Needs you", note: "\(needs.waiting) waiting") {
        Button("Open inbox") { model.navigate(.inbox) }.buttonStyle(.accentLink)
      } content: {
        VStack(alignment: .leading, spacing: 8) {
          ForEach(needs.proposals, id: \.id) { ProposalSummaryRow(proposal: $0) }
          ForEach(needs.failed, id: \.id) { FailedRow(run: $0) }
          if needs.hidden > 0 {
            Button("\(needs.hidden) more in the inbox") { model.navigate(.inbox) }.buttonStyle(.accentLink)
          }
        }
      }
    }
  }
}

/// A proposal as one line that opens its page: a decision wants the whole
/// proposal, not a clamped one.
private struct ProposalSummaryRow: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  let proposal: ArgusProtocol.Proposal

  var body: some View {
    Button {
      model.navigate(.proposal(id: proposal.id))
    } label: {
      Card {
        HStack(spacing: 10) {
          Image(systemName: "lightbulb").foregroundStyle(theme.accent)
          VStack(alignment: .leading, spacing: 2) {
            Text(proposal.title).fontWeight(.medium).lineLimit(1)
            Text(proposal.summary).font(.scaled(.caption)).foregroundStyle(theme.textSecondary).lineLimit(2)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          Image(systemName: "chevron.right").foregroundStyle(theme.textMuted)
        }
      }
      .contentShape(.rect)
    }
    .buttonStyle(.argusPlain)
  }
}

/// The newest automation runs, unread reports first — they happen while
/// nobody is looking, so home is where you find out they did.
struct HomeRecentRunsSection: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme

  private static let limit = 5

  var body: some View {
    let runs = model.automations.runs
      .sorted { $0.unreadReport != $1.unreadReport ? $0.unreadReport : $0.startedAt > $1.startedAt }
    let unread = runs.count { $0.unreadReport }
    HomeSection(title: "Recent runs", note: unread > 0 ? "\(unread) new report\(unread == 1 ? "" : "s")" : nil) {
      Button("View all") { model.navigate(.automations) }.buttonStyle(.accentLink)
    } content: {
      if runs.isEmpty {
        Text("Nothing has run yet. Enable an automation, or try a quick run.")
          .foregroundStyle(theme.textMuted).font(.scaled(.callout))
      } else {
        VStack(alignment: .leading, spacing: 2) {
          ForEach(runs.prefix(Self.limit)) { run in
            Button {
              if run.isQuick {
                model.navigate(.quickRun(runId: run.id))
              } else {
                model.navigate(.automation(id: run.automationId, runId: run.id))
              }
            } label: {
              HStack(spacing: 8) {
                Circle().fill(run.unreadReport ? theme.accent : .clear).frame(width: 6, height: 6)
                Badge(label: run.status.rawValue, tone: run.status.tone)
                Text(run.isQuick ? "Quick run" : run.automationName).lineLimit(1)
                Spacer()
                Text(Labels.timeAgo(run.startedAt)).font(.scaled(.caption)).foregroundStyle(theme.textMuted)
              }
              .padding(.vertical, 5)
              .contentShape(.rect)
            }
            .buttonStyle(.argusPlain)
          }
        }
      }
    }
  }
}

/// A home section: an eyebrow, an optional count, a link, and its rows.
struct HomeSection<Trailing: View, Content: View>: View {
  @Environment(\.theme) private var theme
  let title: String
  var note: String?
  @ViewBuilder let trailing: () -> Trailing
  @ViewBuilder let content: () -> Content

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 8) {
        Text(title.uppercased()).font(.scaled(size: 11, weight: .semibold)).foregroundStyle(theme.textMuted)
        if let note {
          Text(note).font(.scaled(size: 11, weight: .medium)).foregroundStyle(theme.warning)
        }
        Spacer()
        trailing()
      }
      content()
    }
    .frame(maxWidth: .infinity, alignment: .topLeading)
  }
}

/// Home's recents, shared with the Electron app through the host: projects
/// taken off the grid (one comes back the next time you open one of its
/// sessions) and when each was last opened, newest first.
@MainActor
@Observable
final class HomeRecents {
  struct Entry: Codable, Equatable {
    let path: String
    /// Milliseconds since 1970, as Electron stores it.
    let lastOpened: Double

    var plist: [String: Any] { ["path": path, "lastOpened": lastOpened] }
  }

  static let shared = HomeRecents()
  static let hiddenKey = "home.hiddenProjects"
  static let openedKey = "home.recentProjects"
  /// As many as Electron's recents keep.
  private static let cap = 10

  private(set) var hidden: Set<String> = []
  private(set) var opened: [Entry] = []

  private init() {
    reload()
  }

  static func entries(from plist: [Any]) -> [Entry] {
    plist.compactMap { item in
      guard let dict = item as? [String: Any], let path = dict["path"] as? String,
        let lastOpened = dict["lastOpened"] as? Double
      else { return nil }
      return Entry(path: path, lastOpened: lastOpened)
    }
  }

  /// Re-read after the host handed over its copy.
  func reload() {
    hidden = Set(HomeDefaults.shared.stringArray(forKey: Self.hiddenKey) ?? [])
    opened = Self.entries(from: HomeDefaults.shared.array(forKey: Self.openedKey) ?? [])
  }

  /// When a project was last opened, if it was in the recents.
  func lastOpened(_ repoRoot: String) -> Double? {
    opened.first { $0.path == repoRoot }?.lastOpened
  }

  func hide(_ repoRoot: String) {
    hidden.insert(repoRoot)
    HomeDefaults.shared.set(Array(hidden), forKey: Self.hiddenKey)
    setOpened(opened.filter { $0.path != repoRoot })
    MacTelemetry.capture(.homeCardActed(card: .recentProject, action: .dismiss))
  }

  func show(_ repoRoot: String) {
    if hidden.remove(repoRoot) != nil {
      HomeDefaults.shared.set(Array(hidden), forKey: Self.hiddenKey)
    }
    let now = (Date().timeIntervalSince1970 * 1000).rounded()
    setOpened(Array(([Entry(path: repoRoot, lastOpened: now)] + opened.filter { $0.path != repoRoot }).prefix(Self.cap)))
  }

  private func setOpened(_ entries: [Entry]) {
    guard entries != opened else { return }
    opened = entries
    HomeDefaults.shared.set(entries.map(\.plist), forKey: Self.openedKey)
  }
}
