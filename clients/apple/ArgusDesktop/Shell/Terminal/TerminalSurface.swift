import AppKit
import ArgusCore
import SwiftTerm
import SwiftUI

/// One host terminal drawn by SwiftTerm: what it printed so far is replayed on
/// attach, then output streams live; keys and size go back to the PTY.
struct TerminalSurface: NSViewRepresentable {
  @Environment(TerminalsStore.self) private var terminals
  @Environment(\.colorScheme) private var colorScheme
  let terminalId: String
  let isActive: Bool
  let search: TerminalSearchState
  let onNewTab: () -> Void
  let onClose: () -> Void

  func makeCoordinator() -> Coordinator {
    Coordinator(terminalId: terminalId, terminals: terminals)
  }

  func makeNSView(context: Context) -> ArgusTerminalView {
    let view = ArgusTerminalView(
      frame: .zero, font: .monospacedSystemFont(ofSize: 13, weight: .regular),
      options: TerminalOptions(scrollback: 5000))
    view.terminalId = terminalId
    view.terminalDelegate = context.coordinator
    view.optionAsMetaKey = true
    view.onFind = { search.open() }
    view.onNewTab = onNewTab
    view.onClose = onClose
    (colorScheme == .dark ? TerminalPalette.dark : .light).apply(to: view)
    context.coordinator.attach(view)
    search.bind(view)
    return view
  }

  func updateNSView(_ view: ArgusTerminalView, context: Context) {
    view.onNewTab = onNewTab
    view.onClose = onClose
    let scheme = colorScheme
    if context.coordinator.scheme != scheme {
      context.coordinator.scheme = scheme
      (scheme == .dark ? TerminalPalette.dark : .light).apply(to: view)
    }
    // A tab kept alive behind another still lays its I-beam over whatever is in front unless hidden.
    view.isHidden = !isActive
    if isActive {
      search.bind(view)
      // Typing goes to the tab you're looking at, as in the desktop app.
      if !context.coordinator.wasActive { view.focusWhenReady() }
    }
    context.coordinator.wasActive = isActive
  }

  static func dismantleNSView(_ view: ArgusTerminalView, coordinator: Coordinator) {
    coordinator.detach()
  }

  @MainActor
  final class Coordinator: NSObject, TerminalViewDelegate {
    let terminalId: String
    let terminals: TerminalsStore
    var scheme: ColorScheme?
    var wasActive = false
    private var detachFeed: (() -> Void)?
    private weak var view: TerminalView?

    init(terminalId: String, terminals: TerminalsStore) {
      self.terminalId = terminalId
      self.terminals = terminals
    }

    func attach(_ view: TerminalView) {
      self.view = view
      detachFeed = terminals.attach(terminalId) { [weak self] output in
        self?.show(output)
      }
    }

    func detach() {
      detachFeed?()
      detachFeed = nil
    }

    private func show(_ output: TerminalFeed.Output) {
      guard let view else { return }
      switch output {
      case .reset:
        view.getTerminal().resetToInitialState()
        view.needsDisplay = true
        // The PTY may have been drawn at another size before we attached.
        let terminal = view.getTerminal()
        terminals.resize(terminalId, cols: terminal.cols, rows: terminal.rows)
      case .data(let data):
        view.feed(byteArray: ArraySlice(data))
      case .exit:
        break
      }
    }

    // MARK: TerminalViewDelegate

    nonisolated func send(source: TerminalView, data: ArraySlice<UInt8>) {
      let bytes = Data(data)
      MainActor.assumeIsolated { terminals.write(terminalId, bytes) }
    }

    nonisolated func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {
      MainActor.assumeIsolated { terminals.resize(terminalId, cols: newCols, rows: newRows) }
    }

    /// Links open on this Mac, whatever machine the shell runs on.
    nonisolated func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {
      MainActor.assumeIsolated { TerminalLinks.open(link) }
    }

    nonisolated func clipboardCopy(source: TerminalView, content: Data) {
      guard let text = String(data: content, encoding: .utf8) else { return }
      MainActor.assumeIsolated {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
      }
    }

    nonisolated func setTerminalTitle(source: TerminalView, title: String) {}
    nonisolated func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
    nonisolated func scrolled(source: TerminalView, position: Double) {}
    nonisolated func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}
  }
}

/// SwiftTerm's view plus the desktop app's terminal shortcuts. They're taken
/// only while the terminal has focus, so ⌘F elsewhere still finds in chat.
final class ArgusTerminalView: TerminalView {
  var terminalId = ""
  var onFind: () -> Void = {}
  var onNewTab: () -> Void = {}
  var onClose: () -> Void = {}
  private var wantsFocus = false

  /// Take focus now, or as soon as the view is in a window — a new tab's
  /// view isn't yet when it becomes the active one.
  func focusWhenReady() {
    guard let window else { return wantsFocus = true }
    window.makeFirstResponder(self)
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if wantsFocus, let window {
      wantsFocus = false
      DispatchQueue.main.async { window.makeFirstResponder(self) }
    }
  }

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    guard window?.firstResponder === self,
      event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command
    else { return super.performKeyEquivalent(with: event) }
    switch event.charactersIgnoringModifiers {
    case "f":
      onFind()
    case "k":
      // Clear the screen and scrollback here; the shell keeps its state.
      feed(text: "\u{1b}[H\u{1b}[2J\u{1b}[3J")
    case "t":
      onNewTab()
    case "w":
      // The tab, not the window, while you're typing in it.
      onClose()
    default:
      return super.performKeyEquivalent(with: event)
    }
    return true
  }
}
