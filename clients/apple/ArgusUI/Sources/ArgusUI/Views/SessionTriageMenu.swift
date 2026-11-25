import ArgusCore
import SwiftUI

/// Mark as Done / Move Back to Active, its status and note, Mark as Unread, Snooze and Archive with its presets. Menu items:
/// the Mac sidebar's session menu and the phone's session rows.
public struct SessionTriageMenu: View {
  @Environment(HostStore.self) private var host
  let session: RemoteSession
  /// Opens the snooze time picker or the note editor, which the caller presents.
  let present: (SessionTriageSheet) -> Void

  public init(session: RemoteSession, present: @escaping (SessionTriageSheet) -> Void) {
    self.session = session
    self.present = present
  }

  public var body: some View {
    if host.hasControl, session.kind == .worktree || session.kind == .scratchPad {
      if session.isDone {
        Button("Move Back to Active", systemImage: Icon.reopen) {
          // A merged PR would make it done again; only a set status holds it open.
          setStatus(session.pullRequest.map { !$0.isOpen } == true ? .inProgress : nil)
        }
      } else {
        Button("Mark as Done", systemImage: Icon.done) { setStatus(.done) }
          .help("Fold it away under Done. A merged or closed pull request does this on its own")
      }
      statusMenu
      if session.unread == true {
        Button("Mark as Read", systemImage: Icon.markRead) { setUnread(false) }
      } else {
        Button("Mark as Unread", systemImage: Icon.markUnread) { setUnread(true) }
          .help("Keep it under Needs you until you open it again")
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
        Button("Custom") { present(.snooze(session)) }
      }
      if session.isArchived {
        Button("Restore", systemImage: Icon.unarchive) { archive(false) }
      } else {
        Button("Archive", systemImage: Icon.archive) { archive(true) }
          .help("Hide it from the list until you restore it from Archived. Its worktree stays")
      }
    }
  }

  private var statusMenu: some View {
    Menu("Status", systemImage: Icon.workflowStatus) {
      Picker("Status", selection: statusBinding) {
        ForEach(RemoteSessionWorkflowStatus.allCases, id: \.self) { status in
          Text(status.title).tag(Optional(status))
        }
      }
      .pickerStyle(.inline)
      .labelsHidden()
      if session.workflowStatus != nil {
        Button(session.pullRequest == nil ? "Clear Status" : "Follow Pull Request") { setStatus(nil) }
      }
      Divider()
      Button(session.statusNote == nil ? "Add Note" : "Edit Note", systemImage: Icon.note) {
        present(.note(session))
      }
    }
  }

  private var statusBinding: Binding<RemoteSessionWorkflowStatus?> {
    Binding(get: { session.effectiveStatus }, set: { setStatus($0) })
  }

  private func setStatus(_ status: RemoteSessionWorkflowStatus?) {
    Task { await host.setSessionStatus(session, status: status) }
  }

  private func archive(_ archived: Bool) {
    Task { await host.setSessionArchived(session, archived: archived) }
  }

  private func setUnread(_ unread: Bool) {
    Task { await host.setSessionUnread(session, unread: unread) }
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
