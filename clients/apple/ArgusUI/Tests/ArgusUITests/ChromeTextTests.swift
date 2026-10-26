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

  @Test("durations read as seconds, minutes and seconds, or hours and minutes")
  func duration() {
    #expect(ChromeText.duration(29.7) == "29s")
    #expect(ChromeText.duration(329) == "5m 29s")
    #expect(ChromeText.duration(3_840) == "1h 4m")
    #expect(ChromeText.duration(-3) == "0s")
  }

  @Test("the reading column centres, and steps left of a trailing reserve")
  func readingColumn() {
    #expect(ReadingColumn.frame(in: 1400).x == 350)
    #expect(ReadingColumn.frame(in: 1400, reserve: 260).x == 350)
    let shifted = ReadingColumn.frame(in: 1000, reserve: 260)
    #expect(shifted.x + shifted.width == 740)
    #expect(ReadingColumn.frame(in: 600).width == 560)
  }
}
