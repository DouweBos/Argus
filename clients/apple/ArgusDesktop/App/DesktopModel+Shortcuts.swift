import AppKit
import ArgusCore
import ArgusKit

extension DesktopModel {
  /// The session on screen, if it has a repository to act on.
  var gitSession: RemoteSession? {
    guard let id = route.sessionId, let session = session(id), session.status == .ready, !session.isOutsideProjects
    else { return nil }
    return session
  }

  /// Where the menus' keys go; the first responder isn't observable, so `focus` is left out.
  var shortcutContext: ShortcutContext {
    ShortcutContext(
      takesKeys: KeyWindow.shared.takesCommands,
      hasRepository: gitSession != nil,
      inCode: sessionPanel == .code,
      gitInFront: sessionPanel == .git,
      inPullRequests: route.gitView == .pullRequests,
      diffTabFocused: diffTabFocused,
      paletteOpen: palette.isPresented)
  }

  func shortcutContext(in window: NSWindow) -> ShortcutContext {
    var context = shortcutContext
    let composing = (window.firstResponder as? NSTextInputClient)?.hasMarkedText() == true
    context.takesKeys =
      window.identifier?.rawValue.hasPrefix("main") == true && window.attachedSheet == nil
      && NSApp.modalWindow == nil && !composing
    if window.firstResponder is NSTextInputClient {
      let inMessage = route.sessionId.flatMap(git.workspace)?.commitMessageFocused == true
      context.focus = inMessage ? .commitMessage : .text
    }
    return context
  }

  /// Whether a menu shows `chord` on `resolution`, so only one item ever binds it.
  func binds(_ chord: ShortcutChord, to resolution: ShortcutRouter.Resolution) -> Bool {
    ShortcutRouter.resolve(chord, shortcutContext) == resolution
  }

  func run(_ resolution: ShortcutRouter.Resolution) {
    switch resolution {
    case .git(let action): runGitCommand(action, via: .shortcut)
    case .commandPalette: toggleCommandPalette()
    case .findInFiles: activeCodeSession?.findInFiles()
    case .toggleNavigator: activeCodeSession?.navigatorVisible.toggle()
    case .toggleProblems: toggleProblems()
    case .saveAll:
      guard let code = activeCodeSession else { return }
      Task { _ = await code.saveAll() }
    case .pass: break
    }
  }

  func toggleCommandPalette() {
    if palette.isPresented { palette.isPresented = false } else { palette.present() }
  }

  func toggleProblems() {
    guard let code = activeCodeSession else { return }
    languages.client(code.sessionId).problemsExpanded.toggle()
  }
}
