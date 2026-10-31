import CoreGraphics
import Foundation
import Testing

@testable import ArgusUI

@Suite("Image viewer")
struct ImageViewerTests {
  @Test("parses a data URI's bytes and media type")
  func parse() throws {
    let parsed = try #require(ImageViewerItem.parse("data:image/jpeg;base64,AQID"))
    #expect(parsed.data == Data([1, 2, 3]))
    #expect(parsed.mediaType == "image/jpeg")
    #expect(ImageViewerItem.parse("AQID")?.data == nil)
    #expect(ImageViewerItem.parse(",AQID")?.mediaType == "image/png")
    #expect(ImageViewerItem.parse("data:;base64,AQID")?.mediaType == "image/png")
  }

  @Test("names the file after the id and type")
  func fileName() {
    let jpeg = ImageViewerItem(imageId: "a:b/c", dataURI: "data:image/jpeg;base64,AQID")
    #expect(jpeg.fileName == "argus-a-b-c.jpg")
    #expect(ImageViewerItem(imageId: "x", dataURI: nil).fileName == "argus-x.png")
  }

  @Test("fits within the room without upscaling")
  func fitted() {
    let room = CGSize(width: 400, height: 400)
    #expect(ImageViewerItem.fit(CGSize(width: 800, height: 200), in: room) == CGSize(width: 400, height: 100))
    #expect(ImageViewerItem.fit(CGSize(width: 100, height: 50), in: room) == CGSize(width: 100, height: 50))
    #expect(ImageViewerItem.fit(.zero, in: room) == CGSize(width: 240, height: 160))
  }

  @MainActor
  @Test("pages through the message's images, wrapping at both ends")
  func paging() {
    let viewer = ImageViewerState()
    viewer.present(agentKey: "a", imageIds: ["1", "2", "3"], at: 0)
    #expect(viewer.positionLabel == "1 of 3")
    #expect(viewer.previous())
    #expect(viewer.current == "3")
    #expect(viewer.next())
    #expect(viewer.next())
    #expect(viewer.positionLabel == "2 of 3")

    viewer.present(agentKey: "a", imageIds: ["only"], at: 0)
    #expect(viewer.positionLabel == nil)
    #expect(!viewer.next())
    #expect(viewer.current == "only")
  }
}
