import ArgusCore
import ArgusUI
import SwiftUI

/// A session's code view (⌘4): navigator, tabs, the editor and its status
/// bar. The route names the file and line; everything here follows it.
struct CodePanel: View {
  @Environment(DesktopModel.self) private var model
  let session: RemoteSession
  let path: String?
  let line: Int?

  private var code: CodeSession { model.code.session(session.id) }

  var body: some View {
    ResizableHSplit(
      key: "code.navigator", leadingMin: 180, leadingIdeal: 260, leadingMax: 520, trailingMin: 320,
      showsLeading: code.navigatorVisible
    ) {
      CodeNavigator(code: code, activePath: path)
    } trailing: {
      VStack(spacing: 0) {
        CodeTabBar(code: code, activePath: path)
        Divider()
        if let path, let file = code.files[path] {
          CodeEditorPane(code: code, file: file)
            .id(path)
        } else {
          EmptyState(
            icon: "doc.text", title: "No file open",
            body: "Pick a file from the navigator, press ⌘P to open one by name, or ⇧⌘O to open a file or symbol.")
        }
      }
    }
    .overlay(alignment: .top) {
      if code.quickOpenVisible {
        QuickOpenView(code: code).padding(.top, 48)
      }
    }
    // The route is the truth: one call per change of file or line, rendered from state.
    .task(id: RouteTarget(path: path, line: line)) { code.show(path: path, line: line) }
    .task(id: session.id) {
      guard let workspace = await code.gitWorkspace() else { return }
      await workspace.start()
    }
    .onDisappear { model.git.workspace(session.id)?.pause() }
    .background { shortcuts }
  }

  /// The view's own keys, live only while it's on screen.
  @ViewBuilder private var shortcuts: some View {
    Group {
      Button("Save") { if let path { Task { await code.save(path) } } }
        .keyboardShortcut("s", modifiers: .command)
      Button("Save All") { Task { _ = await code.saveAll() } }
        .keyboardShortcut("s", modifiers: [.command, .option])
      Button("Find in Files") {
        code.navigatorVisible = true
        code.navigatorMode = .search
        code.search.focus()
      }
      .keyboardShortcut("f", modifiers: [.command, .shift])
    }
    .hidden()
  }
}

private struct RouteTarget: Hashable {
  let path: String?
  let line: Int?
}
