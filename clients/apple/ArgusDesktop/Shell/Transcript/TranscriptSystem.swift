import AppKit

/// The pasteboard and opener the transcript writes to. A driven debug build
/// points them elsewhere (`ARGUS_TEST_PASTEBOARD`, `ARGUS_STUB_OPENER`), so
/// testing never touches the clipboard or browser of whoever uses the machine.
@MainActor
enum TranscriptSystem {
  static var pasteboard: NSPasteboard {
    #if DEBUG
      if let name = ProcessInfo.processInfo.environment["ARGUS_TEST_PASTEBOARD"] {
        return NSPasteboard(name: NSPasteboard.Name(name))
      }
    #endif
    return .general
  }

  static func copy(_ string: String) {
    let board = pasteboard
    board.clearContents()
    board.setString(string, forType: .string)
  }

  static func open(_ url: URL) {
    if stubbed("open \(url.absoluteString)") { return }
    NSWorkspace.shared.open(url)
  }

  static func open(_ url: URL, with app: URL) {
    if stubbed("open-with \(app.lastPathComponent) \(url.path)") { return }
    NSWorkspace.shared.open([url], withApplicationAt: app, configuration: NSWorkspace.OpenConfiguration())
  }

  /// Records instead of acting when a stub log is configured.
  static func stubbed(_ line: String) -> Bool {
    #if DEBUG
      guard let path = ProcessInfo.processInfo.environment["ARGUS_STUB_OPENER"] else { return false }
      let url = URL(fileURLWithPath: path)
      let data = Data((line + "\n").utf8)
      if let handle = try? FileHandle(forWritingTo: url) {
        handle.seekToEndOfFile()
        handle.write(data)
        try? handle.close()
      } else {
        try? data.write(to: url)
      }
      return true
    #else
      return false
    #endif
  }
}
