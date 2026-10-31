import ArgusUI
import SwiftUI

/// Warnings & errors shown this launch, so a toast that vanished before it
/// was read can still be. The phone's counterpart of the desktop's
/// `/notifications`; it lives in memory, like the desktop's list.
struct WarningsView: View {
  @Environment(AppStore.self) private var app

  var body: some View {
    List {
      ForEach(app.warnings) { warning in
        VStack(alignment: .leading, spacing: 4) {
          BodyText(warning.message)
            .textSelection(.enabled)
          MutedText(Labels.timeAgo(warning.at.timeIntervalSince1970 * 1000))
        }
      }
    }
    .emptyState(when: app.warnings.isEmpty) {
      EmptyState(
        icon: Icon.check, title: "Nothing went wrong",
        body: "Failures shown while you use the app are kept here until it quits.")
    }
    .navigationTitle("Warnings & errors")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if !app.warnings.isEmpty {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Clear") { app.clearWarnings() }
        }
      }
    }
    .onAppear {
      Telemetry.capture(.warningsOpened(count: app.warnings.count))
      app.markWarningsSeen()
    }
  }
}
