import ArgusCore
import CoreGraphics
import Testing

@Suite("Device geometry")
struct DeviceGeometryTests {
  @Test("letterboxes a portrait stream and maps points inside it")
  func portrait() {
    let geometry = DeviceGeometry(
      coded: CGSize(width: 100, height: 200), stage: CGSize(width: 400, height: 200))
    #expect(geometry.pictureRect == CGRect(x: 150, y: 0, width: 100, height: 200))
    #expect(geometry.normalize(CGPoint(x: 200, y: 100)) == CGPoint(x: 0.5, y: 0.5))
    // Outside the picture clamps to its edge.
    #expect(geometry.normalize(CGPoint(x: 0, y: 0)) == CGPoint(x: 0, y: 0))
  }

  @Test("a quarter turn swaps the axes and maps back into panel coordinates")
  func rotated() {
    let geometry = DeviceGeometry(
      coded: CGSize(width: 100, height: 200), stage: CGSize(width: 400, height: 200), rotation: 90)
    #expect(geometry.shown == CGSize(width: 200, height: 100))
    #expect(geometry.renderedSize == CGSize(width: 200, height: 400))
    // The top-left of what we drew is the panel's bottom-left.
    let point = geometry.normalize(CGPoint(x: 0, y: 0))
    #expect(point == CGPoint(x: 0, y: 1))
  }

  @Test("nothing maps before the stream's size is known")
  func unknown() {
    let geometry = DeviceGeometry(coded: .zero, stage: CGSize(width: 10, height: 10))
    #expect(geometry.normalize(.zero) == nil)
    #expect(geometry.renderedSize == CGSize(width: 10, height: 10))
  }
}
