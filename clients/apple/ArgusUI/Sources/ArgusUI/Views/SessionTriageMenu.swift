import ArgusCore
import SwiftUI

/// Mark as Done / Move Back to Active, and Snooze with its presets. Menu items:
/// the Mac sidebar's session menu and the phone's session rows.
public struct SessionTriageMenu: View {
  @Environment(HostStore.self) private var host
  let session: RemoteSession
  /// Opens the custom time picker, which the caller presents.
  let customSnooze: () -> Void

  public init(session: RemoteSession, customSnooze: @escaping () -> Void) {
    self.session = session
    self.customSnooze = customSnooze
  }

  public var body: some View {
    if host.hasControl, session.kind == .worktree || session.kind == .scratchPad {
      if session.isDone {
        Button("Move Back to Active", systemImage: Icon.reopen) {
          // A merged PR would settle it again; only an explicit "keep" holds it open.
          settle(session.pullRequest.map { !$0.isOpen } == true ? false : nil)
        }
      } else {
        Button("Mark as Done", systemImage: Icon.done) { settle(true) }
          .help("Fold it away under Done. A merged or closed pull request does this on its own")
      }
      if session.isSnoozed() {
        Button("Unsnooze", systemImage: Icon.unsnooze) { snooze(nil) }
      }
      Menu(session.isSnoozed() ? "Snooze Instead" : "Snooze", systemImage: Icon.snooze) {
        ForEach(SnoozePreset.allCases, id: \.self) { preset in
          if let date = preset.date() {
            Button(preset.title) { snooze(date) }
          }
        }
        Divider()
        Button("Custom…", action: customSnooze)
      }
    }
  }

  private func settle(_ settled: Bool?) {
    Task { await host.setSessionSettled(session, settled: settled) }
  }

  private func snooze(_ until: Date?) {
    Task { await host.snoozeSession(session, until: until) }
  }
}

/// Snooze until a day and time of your choosing.
public struct SnoozeUntilForm: View {
  @Environment(HostStore.self) private var host
  @Environment(\.dismiss) private var dismiss
  let session: RemoteSession
  @State private var until: Date

  public init(session: RemoteSession) {
    self.session = session
    _until = State(initialValue: session.snoozedUntilDate ?? SnoozePreset.tomorrow.date() ?? .now.addingTimeInterval(3600))
  }

  public var body: some View {
    Form {
      Section {
        DatePicker("Until", selection: $until, in: Date.now..., displayedComponents: [.date, .hourAndMinute])
          #if os(macOS)
            .datePickerStyle(.graphical)
          #endif
      } header: {
        Text(SessionActivity.title(session)).lineLimit(1)
      } footer: {
        Text("It leaves the list until then, and comes back with a notification.")
      }
    }
    .formStyle(.grouped)
    .navigationTitle("Snooze")
    #if os(iOS)
      .navigationBarTitleDisplayMode(.inline)
    #endif
    .toolbar {
      ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
      ToolbarItem(placement: .confirmationAction) {
        Button("Snooze") {
          let date = until
          dismiss()
          Task { await host.snoozeSession(session, until: date) }
        }
        .disabled(until <= .now)
      }
    }
  }
}
