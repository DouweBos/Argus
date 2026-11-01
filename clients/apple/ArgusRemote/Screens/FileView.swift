import ArgusSyntax
import ArgusUI
import SwiftUI

/// Where a file was opened from, for `ios_file_viewed`.
enum FileViewSource: String, Hashable {
  case chatLink = "chat_link"
  case changes
  case quickOpen = "quick_open"
  case search
  /// An `argus://` link or the dev driver.
  case link
}

/// One session file, read-only and highlighted. `path` is as the link had it: an
/// absolute path is placed in the worktree by matching the session's file list.
struct FileView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host

  let sessionId: String
  let path: String
  let line: Int?
  let source: FileViewSource

  @State private var file: ArgusProtocol.CodeFile?
  @State private var relativePath: String?
  @State private var failure: String?
  @State private var focusLine: Int?
  @State private var jumping = false
  @State private var jumpText = ""
  @State private var reported = false

  private var shownPath: String { relativePath ?? path }
  private var language: SyntaxLanguage? {
    let firstLine = file?.content.prefix { $0 != "\n" }.description
    return SyntaxLanguage.detect(path: shownPath, firstLine: firstLine)
  }
  private var lineCount: Int { (file?.content.reduce(0) { $1 == "\n" ? $0 + 1 : $0 } ?? 0) + 1 }

  var body: some View {
    content
      .background(theme.bg.ignoresSafeArea())
      .navigationTitle(SessionFilePaths.fileName(shownPath))
      .navigationBarTitleDisplayMode(.inline)
      .screenBar { title } trailing: { menu }
      .alert("Go to line", isPresented: $jumping) {
        TextField("Line", text: $jumpText).keyboardType(.numberPad)
        Button("Go") { jump() }
        Button("Cancel", role: .cancel) {}
      } message: {
        Text("1–\(lineCount)")
      }
      .task(id: host.connection == .ready) {
        guard file == nil, host.connection == .ready else { return }
        focusLine = line
        await load()
      }
  }

  @ViewBuilder
  private var content: some View {
    if !host.hasControl {
      Screen {
        ControlRequiredBanner(action: "read files")
      }
    } else if let failure {
      Screen {
        EmptyState(icon: Icon.warning, title: "Can't open this file", body: failure)
      }
      .refreshable { await load() }
    } else if let file, let reason = file.readOnlyReason {
      Screen {
        EmptyState(icon: Icon.file, title: "Nothing to show", body: Self.message(for: reason, size: file.size))
      }
      .refreshable { await load() }
    } else if let file {
      CodeView(text: file.content, language: language, focusLine: focusLine)
        .refreshable { await load() }
    } else {
      Screen { Loading(label: "Opening file…") }
    }
  }

  private var title: some View {
    VStack(spacing: 0) {
      HStack(spacing: 6) {
        FileTypeIcon(path: shownPath)
        Text(SessionFilePaths.fileName(shownPath))
          .font(.scaled(size: 15, weight: .semibold))
          .foregroundStyle(theme.text)
          .lineLimit(1)
      }
      let directory = SessionFilePaths.directory(shownPath)
      if !directory.isEmpty || language != nil {
        Text([directory, language?.displayName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
          .font(.scaled(size: 11))
          .foregroundStyle(theme.textMuted)
          .lineLimit(1)
          .truncationMode(.head)
      }
    }
  }

  private var menu: some View {
    Menu {
      if let file, file.readOnlyReason == nil {
        Button("Go to Line…", systemImage: "arrow.down.to.line") {
          jumpText = focusLine.map(String.init) ?? ""
          jumping = true
        }
        Button("Copy Contents", systemImage: "doc.on.doc") { Clipboard.copy(file.content) }
        ShareLink(item: file.content, subject: Text(SessionFilePaths.fileName(shownPath))) {
          Label("Share", systemImage: "square.and.arrow.up")
        }
      }
      Button("Copy Path", systemImage: Icon.link) { Clipboard.copy(shownPath) }
    } label: {
      Image(systemName: Icon.ellipsis)
    }
    .accessibilityLabel("File actions")
  }

  private func jump() {
    guard let target = Int(jumpText.trimmingCharacters(in: .whitespaces)) else { return }
    focusLine = min(max(1, target), lineCount)
  }

  private func load() async {
    guard host.hasControl else { return }
    do {
      if relativePath == nil {
        let files = SessionFilePaths.needsFileList(path) ? await host.listFiles(sessionId: sessionId) : []
        guard let resolved = SessionFilePaths.relative(path, files: files) else {
          failure = "This file isn't part of the session's worktree, so it can't be opened here."
          report()
          return
        }
        relativePath = resolved
      }
      file = try await host.readFile(sessionId: sessionId, path: relativePath ?? path)
      failure = nil
    } catch {
      failure = HostStore.describe(error)
    }
    report()
  }

  private func report() {
    guard !reported else { return }
    reported = true
    Telemetry.capture(.fileViewed(source: source, language: language?.telemetryName ?? "other"))
  }

  static func message(for reason: ArgusProtocol.CodeReadOnlyReason, size: Int) -> String {
    switch reason {
    case .binary: "This is a binary file."
    case .encoding: "This file isn't UTF-8 text, so it can't be shown."
    case .tooLarge:
      "At \(ByteCountFormatStyle().format(Int64(size))) this file is too large to show on a phone."
    default: "This file can't be shown."
    }
  }
}
