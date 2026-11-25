#if os(macOS)
  import AppKit
#endif

/// When a key was last pressed in Argus, so voice mode can tell typing from talking.
@MainActor
enum KeyActivity {
  private static var lastPress: ContinuousClock.Instant?
  private static var monitor: Any?

  static func watch() {
    #if os(macOS)
      guard monitor == nil else { return }
      monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
        lastPress = .now
        return event
      }
    #endif
  }

  /// Long enough for the recognizer to report the click it heard.
  static var typedRecently: Bool {
    lastPress.map { .now - $0 < .milliseconds(1500) } ?? false
  }
}
