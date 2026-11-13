import ArgusUI
import SwiftUI

/// Warnings & errors shown this launch, so a toast that vanished before it
/// was read can still be. The phone's counterpart of the desktop's
/// `/notifications`, over the same log.
struct WarningsView: View {
  @Environment(AppStore.self) private var app
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @State private var triaging = false

  var body: some View {
    let log = app.notifications
    List {
      ForEach(log.entries) { entry in
        NotificationRow(entry: entry)
          .swipeActions {
            Button("Dismiss", role: .destructive) {
              log.dismiss(entry.id)
              Telemetry.capture(.notificationsCleared(scope: .one))
            }
          }
          .swipeActions(edge: .leading) {
            if host.hasControl {
              Button("Triage", systemImage: Icon.triage) { triage(entry) }
                .tint(.accentColor)
            }
          }
          .contextMenu {
            if host.hasControl {
              Button("Triage", systemImage: Icon.triage) { triage(entry) }
            }
          }
      }
      // Empty, the empty state carries this button instead.
      if host.hasControl, !log.entries.isEmpty {
        Section {
          Button("Triage a problem with Argus", systemImage: Icon.triage) {
            triage(nil)
          }
          .disabled(triaging)
        } footer: {
          Text("A read-only agent on the computer reads its logs, diagnoses the problem and drafts an issue. Nothing is posted until you say so.")
        }
      }
    }
    .emptyState(when: log.entries.isEmpty) {
      EmptyState(
        icon: Icon.check, title: "Nothing went wrong",
        body: "Failures shown while you use the app are kept here until it quits."
      ) {
        if host.hasControl {
          Button("Triage a problem with Argus", systemImage: Icon.triage) { triage(nil) }
            .disabled(triaging)
        }
      }
    }
    .navigationTitle("Notifications")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if !log.entries.isEmpty {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Clear") {
            log.clear()
            Telemetry.capture(.notificationsCleared(scope: .all))
          }
        }
      }
    }
    .onAppear {
      Telemetry.capture(.warningsOpened(count: log.entries.count))
      log.markSeen()
    }
    .onChange(of: log.entries) { log.markSeen() }
  }

  private func triage(_ entry: NotificationsLog.Entry?) {
    triaging = true
    Task {
      defer { triaging = false }
      guard let agent = await host.startTriage(entry) else { return }
      router.push(.agent(id: agent.agentId, label: Labels.agentName(agent)))
    }
  }
}

private struct NotificationRow: View {
  @Environment(\.theme) private var theme
  let entry: NotificationsLog.Entry

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      Image(systemName: Icon.warning)
        .foregroundStyle(entry.level == .error ? theme.error : theme.warning)
      VStack(alignment: .leading, spacing: 4) {
        BodyText(entry.message)
          .textSelection(.enabled)
        MutedText(meta)
      }
    }
    .accessibilityElement(children: .combine)
  }

  private var meta: String {
    [
      entry.level.rawValue, entry.source, entry.count > 1 ? "×\(entry.count)" : nil,
      Labels.timeAgo(entry.timestamp.timeIntervalSince1970 * 1000),
    ].compactMap { $0 }.joined(separator: " · ")
  }
}
