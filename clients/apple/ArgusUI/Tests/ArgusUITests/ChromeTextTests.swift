import Foundation
import Testing

@testable import ArgusUI

@Suite("Chrome text")
struct ChromeTextTests {
  @Test("initials take the first two words, else the first two letters")
  func initials() {
    #expect(ChromeText.initials("react-native-client") == "RN")
    #expect(ChromeText.initials("Argus") == "AR")
    #expect(ChromeText.initials("iOS App") == "IA")
    #expect(ChromeText.initials("") == "")
  }

  @Test("ages read as the tightest unit, from milliseconds or seconds")
  func shortAge() {
    let now = Date(timeIntervalSince1970: 2_000_000_000)
    let ms = now.timeIntervalSince1970 * 1000
    #expect(ChromeText.shortAge(ms - 10_000, now: now) == "now")
    #expect(ChromeText.shortAge(ms - 5 * 60_000, now: now) == "5m")
    #expect(ChromeText.shortAge(ms - 4 * 3_600_000, now: now) == "4h")
    #expect(ChromeText.shortAge(ms - 3 * 86_400_000, now: now) == "3d")
    #expect(ChromeText.shortAge(ms - 21 * 86_400_000, now: now) == "3w")
    #expect(ChromeText.shortAge(now.timeIntervalSince1970 - 7200, now: now) == "2h")
    #expect(ChromeText.shortAge(ms + 60_000, now: now) == "now")
  }
}
