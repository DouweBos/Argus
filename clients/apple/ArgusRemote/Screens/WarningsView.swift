import ArgusUI
import SwiftUI

/// Warnings & errors shown this launch, so a toast that vanished before it
/// was read can still be. The phone's counterpart of the desktop's
/// `/notifications`, over the same log.
struct WarningsView: View {
  @Environment(AppStore.self) private var app

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
      }
    }
    .emptyState(when: log.entries.isEmpty) {
      EmptyState(
        icon: Icon.check, title: "Nothing went wrong",
        body: "Failures shown while you use the app are kept here until it quits.")
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
