import ArgusCore
import ArgusKit
import CoreGraphics
import Foundation
import ImageIO
import Testing
import UniformTypeIdentifiers

@testable import ArgusUI

@Suite("PickedElement")
struct PickedElementTests {
  @Test("a browser element names its selector, component and styles, and carries the crop")
  func browser() {
    let element = ArgusProtocol.BrowserElement(
      label: "button.btn", bounds: .init(x: 100, y: 100, width: 120, height: 35),
      viewport: .init(width: 800, height: 600), selector: "main > button.btn", tagName: "button",
      text: "Save", attributes: ["aria-label": "Save"], styles: ["color": "red"], html: "<button>Save</button>",
      component: "SaveButton", source: "src/Save.tsx:4", url: "http://localhost:3000/", screenshot: "AAAA")
    let picked = PickedElement.browser(element)
    #expect(picked.title == "SaveButton · button.btn")
    #expect(picked.context.contains("Selector: `main > button.btn`"))
    #expect(picked.context.contains("React component: SaveButton (src/Save.tsx:4)"))
    #expect(picked.context.contains("Computed styles: color: red"))
    #expect(picked.crop?.mediaType == "image/png")
  }

  @Test("a Vue element names its framework; a source with no component still goes out")
  func frameworks() {
    func element(framework: ArgusProtocol.BrowserElementFramework?, component: String?) -> PickedElement {
      .browser(ArgusProtocol.BrowserElement(
        label: "div", bounds: .init(x: 0, y: 0, width: 1, height: 1), viewport: .init(width: 1, height: 1),
        selector: "div", tagName: "div", attributes: [:], styles: [:], html: "<div></div>",
        framework: framework, component: component, source: "src/Card.vue:7", url: "http://localhost:5173/"))
    }
    #expect(element(framework: .vue, component: "Card").context.contains("Vue component: Card (src/Card.vue:7)"))
    #expect(element(framework: nil, component: nil).context.contains("Source: src/Card.vue:7"))
  }

  @Test("a device node gives its view path and a crop scaled to the screenshot")
  func device() throws {
    var button = Inspection.Node(
      id: "b", className: "UIButton", frame: .init(x: 10, y: 20, w: 50, h: 30), depth: 1)
    button.accessibilityIdentifier = "save"
    let root = Inspection.Node(
      id: "w", className: "UIWindow", frame: .init(x: 0, y: 0, w: 100, h: 200), depth: 0, children: [button])
    let capture = Inspection.Capture(
      capturedAt: "", device: .init(deviceId: "d", platform: "ios", width: 100, height: 200),
      hierarchy: root, nodeCount: 2, screenshot: try png(width: 200, height: 400))
    let picked = PickedElement.device(button, path: [root, button], capture: capture)
    #expect(picked.title == "UIButton \"save\"")
    #expect(picked.context.contains("View path: UIWindow > UIButton"))
    let data = try #require(picked.crop.flatMap { Data(base64Encoded: $0.data) })
    let image = try #require(CGImageSourceCreateWithData(data as CFData, nil).flatMap {
      CGImageSourceCreateImageAtIndex($0, 0, nil)
    })
    // (50 + 2 × 8 pt padding) × (30 + 2 × 8 pt) at 2×.
    #expect(image.width == 132)
    #expect(image.height == 92)
  }

  @Test("an Android node says emulator and measures in pixels")
  func android() {
    let view = Inspection.Node(
      id: "0", className: "android.widget.TextView", frame: .init(x: 0, y: 0, w: 1080, h: 2400), depth: 0)
    let capture = Inspection.Capture(
      capturedAt: "", device: .init(deviceId: "e", platform: "android", width: 1080, height: 2400),
      hierarchy: view, nodeCount: 1, screenshot: nil)
    let picked = PickedElement.device(view, path: [view], capture: capture)
    #expect(picked.context.hasPrefix("[Picked element — Android emulator]"))
    #expect(picked.context.contains("1080×2400 px on a 1080×2400 px screen"))
  }

  private func png(width: Int, height: Int) throws -> Data {
    let context = try #require(
      CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
    let image = try #require(context.makeImage())
    let out = NSMutableData()
    let destination = try #require(
      CGImageDestinationCreateWithData(out, UTType.png.identifier as CFString, 1, nil))
    CGImageDestinationAddImage(destination, image, nil)
    #expect(CGImageDestinationFinalize(destination))
    return out as Data
  }
}
