import Testing

@testable import ArgusUI

@Suite struct ProjectAccentTests {
  /// Indices the desktop app's `projectAccent` gives the same paths.
  @Test func matchesTheDesktopPalette() {
    #expect(ProjectAccent.index(for: "/Users/douwe/Work/Houwert/Projects/Argus") == 4)
    #expect(ProjectAccent.index(for: "/Users/douwe/Work/Plex/Projects/react-native-client") == 8)
    #expect(ProjectAccent.index(for: "/tmp/é") == 3)
    #expect(ProjectAccent.index(for: "") == 0)
  }
}
