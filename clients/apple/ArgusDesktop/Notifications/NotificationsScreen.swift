import ArgusUI
import SwiftUI

/// `/notifications`: every warning and error the app raised this run.
struct NotificationsScreen: View {
  @Environment(DesktopModel.self) private var model

  var body: some View {
    let log = model.notificationsLog
    Group {
      if log.entries.isEmpty {
        EmptyState(
          icon: "checkmark.circle", title: "No warnings or errors",
          body: "Anything that goes wrong shows up here."
        )
      } else {
        List(log.entries) { entry in
          NotificationRow(entry: entry) { log.dismiss(entry.id) }
        }
      }
    }
    .navigationTitle("Notifications")
    .navigationSubtitle(subtitle(log))
    .toolbar {
      ToolbarItem {
        Button("Clear All") { log.clear() }
          .disabled(log.entries.isEmpty)
      }
    }
    .onAppear { log.markSeen() }
    .onChange(of: log.entries) { log.markSeen() }
  }

  private func subtitle(_ log: NotificationsLog) -> String {
    let errors = log.entries.count { $0.level == .error }
    let warnings = log.entries.count - errors
    return "\(errors) error\(errors == 1 ? "" : "s"), \(warnings) warning\(warnings == 1 ? "" : "s")"
  }
}

private struct NotificationRow: View {
  @Environment(\.theme) private var theme
  let entry: NotificationsLog.Entry
  let dismiss: () -> Void

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      Image(systemName: "exclamationmark.triangle.fill")
        .foregroundStyle(entry.level == .error ? theme.error : theme.warning)
      VStack(alignment: .leading, spacing: 4) {
        Text(entry.message).textSelection(.enabled)
        HStack(spacing: 6) {
          Text(entry.level.rawValue).font(.scaled(.caption)).foregroundStyle(.secondary)
          if entry.count > 1 {
            Text("×\(entry.count)").font(.scaled(.caption)).foregroundStyle(.secondary)
          }
          if let source = entry.source {
            Text(source).font(.scaled(.caption)).foregroundStyle(.secondary)
          }
          Text(entry.timestamp, style: .relative).font(.scaled(.caption)).foregroundStyle(.tertiary)
        }
      }
      Spacer()
      Button(action: dismiss) { Image(systemName: "xmark") }
        .buttonStyle(.argusBorderless)
        .help("Dismiss")
    }
    .padding(.vertical, 4)
  }
}
