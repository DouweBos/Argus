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
    var tracker = TextScaleTracker()
    let unchanged = tracker.changed()
    TextScale.shared.factor = 17 / 13
    let first = tracker.changed()
    let second = tracker.changed()
    #expect(!unchanged && first && !second)
    #expect(BlameMetrics.font.pointSize > 11.5)
    #expect(GitUIStyle.argus(.dark, scale: TextScale.shared.factor).fontScale == CGFloat(17) / 13)
  }
}
