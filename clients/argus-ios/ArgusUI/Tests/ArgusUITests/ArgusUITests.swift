import Foundation
import Testing

@testable import ArgusUI

@Suite("Platform")
struct PlatformTests {
  /// A 1×1 transparent PNG.
  private static let pixel =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="

  @Test("a transcript data URI decodes to an image")
  func dataURI() throws {
    let image = try #require(PlatformImage.fromDataURI("data:image/png;base64,\(Self.pixel)"))
    #expect(image.size.width == 1)
    #expect(image.jpegData(quality: 0.8) != nil)
  }

  @Test("anything that isn't a data URI is no image")
  func garbage() {
    #expect(PlatformImage.fromDataURI("not a uri") == nil)
    #expect(PlatformImage.fromDataURI("data:image/png;base64,!!!") == nil)
  }
}
