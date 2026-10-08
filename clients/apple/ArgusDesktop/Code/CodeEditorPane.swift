import ArgusCore
import ArgusEditor
import ArgusUI
import SwiftUI

/// One file: the disk banner when it moved under unsaved edits, then the
/// editor (or why it can't be edited here), then the status bar.
struct CodeEditorPane: View {
  @Environment(DesktopModel.self) private var model
  let code: CodeSession
  @Bindable var file: CodeFile

  var body: some View {
    VStack(spacing: 0) {
      if let banner = file.disk.banner {
        CodeDiskBanner(
          banner: banner, deleted: file.disk.isDeleted,
          compare: { Task { await code.compare(file.path) } },
          keepMine: { code.resolveKeepingMine(file.path) },
          reload: { Task { await code.resolveWithReload(file.path) } })
        Divider()
      }
      content.frame(maxWidth: .infinity, maxHeight: .infinity)
      if let document = file.document {
        Divider()
        CodeStatusBar(code: code, file: file, document: document)
      }
    }
    .sheet(isPresented: comparing) {
      if let comparison = file.comparison {
        CodeCompareSheet(
          path: file.path, comparison: comparison,
          keepMine: { code.resolveKeepingMine(file.path) },
          reload: { Task { await code.resolveWithReload(file.path) } },
          close: { file.comparison = nil })
      }
    }
  }

  @ViewBuilder private var content: some View {
    switch file.phase {
    case .loading:
      ProgressView().controlSize(.small)
    case .ready(let document):
      CodeEditorView(document: document)
        .onChange(of: document.find.isVisible) { wasVisible, visible in
          // In-file find, counted when the bar closes after a search.
          guard wasVisible, !visible, !document.find.query.text.isEmpty else { return }
          MacTelemetry.capture(
            .editorSearchRun(
              scope: .file, regex: document.find.query.isRegex,
              resultBucket: MacTelemetryEvent.countBucket(document.find.matches.count), truncated: false))
        }
    case .readOnly(let reason):
      ContentUnavailableView {
        Label(Self.title(reason), systemImage: "doc.questionmark")
      } description: {
        Text("Argus only edits UTF-8 text files up to 5 MB.")
      } actions: {
        Button("Open Externally") { Task { await code.openExternally(file.path) } }
      }
    case .failed(let message):
      ContentUnavailableView {
        Label("Couldn't open \(file.name)", systemImage: "exclamationmark.triangle")
      } description: {
        Text(message)
      } actions: {
        Button("Try Again") { code.retry(file.path) }
      }
    }
  }

  private var comparing: Binding<Bool> {
    Binding(get: { file.comparison != nil }, set: { if !$0 { file.comparison = nil } })
  }

  static func title(_ reason: ArgusProtocol.CodeReadOnlyReason) -> String {
    switch reason {
    case .binary: "Binary file"
    case .tooLarge: "File too large"
    case .encoding: "Not UTF-8 text"
    default: "Can't edit this file"
    }
  }
}

/// "Changed on disk": the file moved under unsaved edits, or a save found it had.
struct CodeDiskBanner: View {
  @Environment(\.theme) private var theme
  let banner: CodeDiskState.Banner
  let deleted: Bool
  let compare: () -> Void
  let keepMine: () -> Void
  let reload: () -> Void

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(theme.warning)
      VStack(alignment: .leading, spacing: 1) {
        Text(title).font(.scaled(size: 12, weight: .semibold))
        Text("Your edits aren't saved. Nothing is overwritten until you choose.")
          .font(.scaled(size: 11)).foregroundStyle(theme.textSecondary)
      }
      Spacer()
      if !deleted { Button("Compare", action: compare) }
      Button("Keep Mine", action: keepMine).help("The next save replaces what's on disk")
      if !deleted { Button("Reload", action: reload).help("Take the disk's version; ⌘Z brings yours back") }
    }
    .controlSize(.small)
    .padding(.horizontal, 12)
    .padding(.vertical, 6)
    .background(theme.warningSoft)
  }

  private var title: String {
    if deleted { return "Deleted on disk" }
    return banner == .saveConflict ? "Not saved: the file changed on disk" : "Changed on disk"
  }
}

/// Compare: the disk's text on the left, the buffer on the right, in the git diff view.
struct CodeCompareSheet: View {
  let path: String
  let comparison: CodeHunks
  let keepMine: () -> Void
  let reload: () -> Void
  let close: () -> Void

  var body: some View {
    VStack(spacing: 0) {
      DiffPane(diff: comparison.diffResult(path: path), path: "\(path) — disk ↔ your edits")
      Divider()
      HStack {
        Text("Removed lines are on disk only; added lines are your unsaved edits.")
          .font(.scaled(size: 11)).foregroundStyle(.secondary)
        Spacer()
        Button("Close", action: close).keyboardShortcut(.cancelAction)
        Button("Reload", action: reload)
        Button("Keep Mine", action: keepMine).keyboardShortcut(.defaultAction)
      }
      .padding(12)
    }
    .frame(minWidth: 760, minHeight: 520)
  }
}
