import ArgusCore
import ArgusEditor
import ArgusUI
import SwiftUI

extension MacTelemetryEvent {
  /// Where the code view's blame was clicked.
  enum EditorBlameSource: String {
    case statusBar = "status_bar"
    case inline
  }
}

extension CodeSession {
  /// The caret line's blame after its last character, while Settings → Editor → Inline blame is on.
  func inlineBlame(_ file: CodeFile) -> (Int) -> EditorLineAnnotation? {
    { [weak self, weak file] line in
      guard AppPreferences.shared.editorInlineBlame, let self, let file, let blame = file.lineBlame(line) else {
        return nil
      }
      guard case .committed(let commit) = blame else { return EditorLineAnnotation(text: blame.label()) }
      return EditorLineAnnotation(text: blame.label(), help: Self.blameHelp(commit)) { [weak self] in
        self?.openBlamedCommit(commit.sha, from: .inline)
      }
    }
  }

  /// The commit in the git view's history, selected.
  func openBlamedCommit(_ sha: String, from source: MacTelemetryEvent.EditorBlameSource) {
    MacTelemetry.capture(.editorBlameCommitOpened(source: source))
    model?.revealCommit(sha, inSession: sessionId)
  }

  static func blameHelp(_ commit: LineBlame.Commit) -> String {
    "\(commit.sha.prefix(7)) · \(commit.author) · \(commit.date.formatted(date: .abbreviated, time: .shortened))\n"
      + "\(commit.summary)\nClick to show the commit in History"
  }
}

/// The status bar's blame for the caret line; a commit opens in History.
struct CodeBlameItem: View {
  let code: CodeSession
  let blame: LineBlame

  var body: some View {
    switch blame {
    case .uncommitted:
      Label(blame.label(), systemImage: "pencil.circle").help("This line has changes no commit has yet")
    case .committed(let commit):
      Button {
        code.openBlamedCommit(commit.sha, from: .statusBar)
      } label: {
        Label(blame.label(), systemImage: "person.crop.circle")
          .truncationMode(.tail)
      }
      .buttonStyle(.argusPlain)
      .help(CodeSession.blameHelp(commit))
    }
  }
}

extension DesktopModel {
  /// The git view's History with `sha` selected: how any screen shows one commit.
  func revealCommit(_ sha: String, inSession id: String) {
    navigate(.sessionGit(id: id, view: .history))
    guard let workspace = git.workspace(id) else { return }
    Task { await workspace.history.reveal(sha) }
  }
}
