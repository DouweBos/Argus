import AppKit
import Testing

@testable import Argus

/// Runs in the app as its test host, so this is the menu bar SwiftUI built from the scenes.
@MainActor
struct FileMenuTests {
  private var fileMenu: NSMenu? {
    NSApp.mainMenu?.items.first { $0.title == "File" }?.submenu
  }

  @Test("File has Save on ⌘S and Save All, and keeps Close for the device popouts")
  func saveItems() throws {
    let menu = try #require(fileMenu)
    let save = try #require(menu.items.first { $0.title == "Save" })
    #expect(save.keyEquivalent == "s")
    #expect(save.keyEquivalentModifierMask.intersection(.deviceIndependentFlagsMask) == .command)
    #expect(menu.items.contains { $0.title == "Save All" })
    #expect(menu.items.contains { $0.title == "Close" })
  }
}
