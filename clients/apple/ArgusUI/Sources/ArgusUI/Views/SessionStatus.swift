import ArgusCore
import SwiftUI

/// A workflow status as the issue-status circle: empty, half, three quarters, checked.
public struct SessionStatusGlyph: View {
  let status: RemoteSessionWorkflowStatus
  let size: CGFloat

  public init(_ status: RemoteSessionWorkflowStatus, size: CGFloat = 12) {
    self.status = status
    self.size = size
  }

  public var body: some View {
    IssueStatusGlyph(type: Self.glyphType(status), size: size)
      .accessibilityElement()
      .accessibilityLabel(status.title)
  }

  static func glyphType(_ status: RemoteSessionWorkflowStatus) -> String {
    switch status {
    case .todo: "unstarted"
    case .inProgress: "started"
    case .inReview: "review"
    case .done: "completed"
    }
  }
}

/// A sheet a session's triage menu opens; the screen holding the menu presents it.
public enum SessionTriageSheet: Identifiable, Hashable {
  case snooze(RemoteSession)
  case note(RemoteSession)

  public var id: String {
    switch self {
    case .snooze(let session): "snooze-\(session.id)"
    case .note(let session): "note-\(session.id)"
    }
  }
}

/// The form for a `SessionTriageSheet`, in its own navigation stack.
public struct SessionTriageSheetView: View {
  let sheet: SessionTriageSheet

  public init(_ sheet: SessionTriageSheet) { self.sheet = sheet }

  public var body: some View {
    NavigationStack {
      switch sheet {
      case .snooze(let session): SnoozeUntilForm(session: session)
      case .note(let session): SessionNoteForm(session: session)
      }
    }
  }
}

extension View {
  /// Presents the triage menu's snooze and note sheets.
  public func sessionTriageSheet(_ sheet: Binding<SessionTriageSheet?>) -> some View {
    argusSheet(item: sheet) { sheet in
      SessionTriageSheetView(sheet)
        #if os(macOS)
          .frame(width: 340, height: sheetHeight(sheet))
        #endif
    }
  }
}

private func sheetHeight(_ sheet: SessionTriageSheet) -> CGFloat {
  if case .snooze = sheet { return 440 }
  return 220
}

/// A one-line note on where a session stands, shown under its title in the lists.
public struct SessionNoteForm: View {
  @Environment(HostStore.self) private var host
  @Environment(\.dismiss) private var dismiss
  let session: RemoteSession
  @State private var note: String

  public init(session: RemoteSession) {
    self.session = session
    _note = State(initialValue: session.statusNote ?? "")
  }

  public var body: some View {
    Form {
      Section {
        TextField("Note", text: $note, prompt: Text("Waiting on CI"))
          .labelsHidden()
          .onSubmit(save)
      } header: {
        Text(SessionActivity.title(session)).lineLimit(1)
      } footer: {
        Text("One line on where it stands. Agents can set it too.")
      }
    }
    .formStyle(.grouped)
    .navigationTitle(session.statusNote == nil ? "Add Note" : "Edit Note")
    #if os(iOS)
      .navigationBarTitleDisplayMode(.inline)
    #endif
    .toolbar {
      ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
      ToolbarItem(placement: .confirmationAction) { Button("Save", action: save) }
    }
  }

  private func save() {
    let line = note.trimmingCharacters(in: .whitespacesAndNewlines)
    dismiss()
    // Empty clears it; the status stays as it is.
    Task { await host.setSessionStatus(session, status: session.workflowStatus, note: line) }
  }
}
