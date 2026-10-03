import AppKit

/// Terminal links open on this Mac — the machine you're sitting at — even
/// when the shell runs on a host elsewhere.
@MainActor
enum TerminalLinks {
  static func open(_ link: String) {
    guard let url = URL(string: link), url.scheme != nil else { return NSSound.beep() }
    MacTelemetry.capture(.terminalUsed(action: .openLink))
    #if DEBUG
      // A dev build being driven logs what it would have opened.
      if ProcessInfo.processInfo.environment["ARGUS_DEV_DRY_OPEN"] != nil {
        NSLog("[argus] dry-open url %@", link)
        lastDryOpen = link
        return
      }
    #endif
    NSWorkspace.shared.open(url)
  }

  #if DEBUG
    static var lastDryOpen: String?
  #endif
}
