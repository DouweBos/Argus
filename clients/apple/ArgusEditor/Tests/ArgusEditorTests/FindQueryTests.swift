import Foundation
import XCTest

@testable import ArgusEditor

final class FindQueryTests: XCTestCase {
  let text = "let value = Value + values; // value" as NSString

  func testLiteralIsCaseInsensitiveByDefault() throws {
    XCTAssertEqual(try FindQuery(text: "value").matches(in: text).count, 4)
    XCTAssertEqual(try FindQuery(text: "Value", isCaseSensitive: true).matches(in: text).count, 1)
  }

  func testLiteralEscapesRegexCharacters() throws {
    XCTAssertEqual(try FindQuery(text: "a.b").matches(in: "a.b axb"), [NSRange(location: 0, length: 3)])
  }

  func testWholeWord() throws {
    let ranges = try FindQuery(text: "value", isWholeWord: true).matches(in: text)
    XCTAssertEqual(ranges.map { text.substring(with: $0) }, ["value", "Value", "value"])
    XCTAssertEqual(try FindQuery(text: "_id", isWholeWord: true).matches(in: "user_id _id"), [NSRange(location: 8, length: 3)])
  }

  func testRegexAndTemplates() throws {
    let query = FindQuery(text: "(\\w+) = (\\w+)", isRegex: true)
    let matches = try query.matches(in: text)
    XCTAssertEqual(matches.count, 1)
    XCTAssertEqual(try query.replacement(for: matches[0], in: text, template: "$2 = $1"), "Value = value")
    XCTAssertEqual(try FindQuery(text: "x", isRegex: false).replacement(for: NSRange(location: 0, length: 1), in: "x", template: "$1"), "$1")
  }

  func testInvalidPatternThrowsAndEmptyMatchesAreSkipped() {
    XCTAssertThrowsError(try FindQuery(text: "(", isRegex: true).matches(in: text))
    XCTAssertEqual(try FindQuery(text: "^", isRegex: true).matches(in: text), [])
    XCTAssertEqual(try FindQuery(text: "").matches(in: text), [])
  }
}
