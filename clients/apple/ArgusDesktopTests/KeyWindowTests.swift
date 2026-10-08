import AppKit
import Testing

@testable import Argus

@MainActor
struct KeyWindowTests {
  private func window(_ id: String?) -> NSWindow {
    let window = NSWindow(
      contentRect: .zero, styleMask: [.titled], backing: .buffered, defer: true)
    window.identifier = id.map { NSUserInterfaceItemIdentifier($0) }
    return window
  }

  @Test("⌘W closes a tab in the main window and the window itself anywhere else")
  func classifiesWindows() {
    #expect(KeyWindow.isMain(nil))
    #expect(KeyWindow.isMain(window("main")))
    #expect(!KeyWindow.isMain(window("Device-AppWindow-1")))
    #expect(!KeyWindow.isMain(window(nil)))
  }
}
