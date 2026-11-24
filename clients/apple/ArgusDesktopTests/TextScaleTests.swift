import ArgusCore
import ArgusUI
import Foundation
import GroveUIKit
import Testing

@testable import Argus

@MainActor
@Suite(.serialized)
struct TextScaleTests {
  @Test func displaySizesScaleFromMacOSsBody() throws {
    let prefs = AppPreferences(defaults: try #require(UserDefaults(suiteName: "argus-tests-\(UUID().uuidString)")))
    prefs.displaySize = .larger
    #expect(prefs.textScale * 13 == 17)
    prefs.displaySize = .smaller
    #expect(prefs.textScale * 13 == 11)
    prefs.displaySize = .default
    #expect(prefs.textScale == 1)
    #expect(TextScale.shared.factor == 1)
  }

  @Test func appKitMetricsAndTablesFollowTheScale() {
    defer { TextScale.shared.factor = 1 }
    // The kit's tables restyle when the style changes; Blame's own sizes are checked in GroveUIKit's zoomScalesTheBlame.
    let unchanged = GitUIStyle.argus(.dark, scale: TextScale.shared.factor)
    TextScale.shared.factor = 17 / 13
    let zoomed = GitUIStyle.argus(.dark, scale: TextScale.shared.factor)
    #expect(unchanged != zoomed)
    #expect(zoomed == GitUIStyle.argus(.dark, scale: TextScale.shared.factor))
    #expect(zoomed.fontScale == CGFloat(17) / 13)
  }
}
