import ArgusCore
import ArgusUI
import SwiftUI

/// A session's code view (⌘3): navigator, tabs, the editor and its status
/// bar. The route names the file and line; everything here follows it.
struct CodePanel: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  let session: RemoteSession
  let path: String?
  let line: Int?

  private var code: CodeSession { model.code.session(session.id) }

  private var emptyMessage: String {
    switch (ShortcutCommand.quickOpen(.files).hint, ShortcutCommand.quickOpen(.openQuickly).hint) {
    case let (byName?, quickly?):
      "Pick a file from the navigator, press \(byName) to open one by name, or \(quickly) to open a file or symbol."
    case let (byName?, nil): "Pick a file from the navigator, or press \(byName) to open one by name."
    case let (nil, quickly?): "Pick a file from the navigator, or press \(quickly) to open a file or symbol."
    case (nil, nil): "Pick a file from the navigator."
    }
  }

  var body: some View {
    ResizableHSplit(
      key: "code.navigator", leadingMin: 180, leadingIdeal: 260, leadingMax: 520, trailingMin: 320,
      showsLeading: code.navigatorVisible
    ) {
      CodeNavigator(code: code, activePath: path)
    } trailing: {
      VStack(spacing: 0) {
        CodeTabBar(code: code, activePath: path)
          .padding(.trailing, SessionContextCardOverlay.barReserve)
        Rectangle().fill(theme.border).frame(height: 1)
        if let path, let file = code.files[path] {
          CodeEditorPane(code: code, file: file)
            .id(path)
        } else {
          QuietEmptyState(
            icon: "doc.text", title: "No file open",
            message: emptyMessage)
        }
      }
      .sessionContextCard(session, panel: .code, barHeight: CodeTabBar.height)
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
      Button("Find in Files") { code.findInFiles() }
      .keyboardShortcut(model.menuShortcut(.findInFiles))
    }
    .hidden()
  }
}

private struct RouteTarget: Hashable {
  let path: String?
  let line: Int?
}
