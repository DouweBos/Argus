import ArgusKit
import Foundation
import Testing

@testable import ArgusUI

@MainActor
@Suite("Toggle list")
struct ToggleListTests {
  @Test("switching one on appends it, off removes it, and nothing doubles")
  func toggled() {
    #expect(ToggleList.toggled(["a"], "b", on: true) == ["a", "b"])
    #expect(ToggleList.toggled(["a", "b"], "a", on: false) == ["b"])
    #expect(ToggleList.toggled(["a"], "a", on: true) == ["a"])
  }

  @Test("an automation's projects keep one the computer no longer lists")
  func projectOptions() throws {
    let projects = try JSONDecoder().decode(
      [RemoteProject].self, from: Data(#"[{"repo_root":"/r/argus","name":"Argus"}]"#.utf8))

    let options = AutomationFields.projectOptions(projects, picked: ["/r/argus", "/r/gone"])

    #expect(options.map(\.id) == ["/r/argus", "/r/gone"])
    #expect(options.map(\.label) == ["Argus", "gone"])
    #expect(options[0].hint == nil)
    #expect(options[1].hint != nil)
  }
}
