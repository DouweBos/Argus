import Foundation
import Testing

@testable import Argus

@MainActor
struct CodeLayoutTests {
  @Test func theNavigatorStaysAsTheUserLeftIt() {
    let name = "argus-tests-\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: name)!
    defer { defaults.removePersistentDomain(forName: name) }
    #expect(CodeLayout(defaults: defaults).navigatorVisible, "shown by default")
    let layout = CodeLayout(defaults: defaults)
    layout.navigatorVisible = false
    #expect(!CodeLayout(defaults: defaults).navigatorVisible, "hidden survives a relaunch")
  }
}
