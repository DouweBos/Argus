import ArgusCore
import Foundation
import Testing

/// Trimmed from `app/features/inspection/__fixtures__/raw-ios-capture.json`.
private let rawCapture = """
  {
    "capturedAt": "2026-04-22T10:05:00.000Z",
    "device": { "platform": "ios", "deviceId": "RAW-IPHONE-16", "width": 390, "height": 844 },
    "screenshot": { "kind": "composite", "encoding": "png", "data": "iVBORw0KGgo=" },
    "inspect": {
      "status": "ok",
      "nodeCount": 3,
      "windows": [
        {
          "id": "0x1", "class": "UIWindow", "depth": 0,
          "frame": { "x": 0, "y": 0, "w": 390, "h": 844 },
          "absFrame": { "x": 0, "y": 0, "w": 390, "h": 844 },
          "children": [
            {
              "id": "0x2", "class": "UIButton", "depth": 1,
              "frame": { "x": 24, "y": 300, "w": 342, "h": 50 },
              "absFrame": { "x": 24, "y": 300, "w": 342, "h": 50 },
              "title": "Sign In", "titleColor": "#FFFFFFFF", "backgroundColor": "#007AFFFF",
              "accessibilityIdentifier": "btn_sign_in", "enabled": false,
              "font": { "name": "SFUI-Semibold", "family": ".SF UI", "size": 17, "bold": true },
              "rn": { "testID": "sign-in" },
              "children": [
                {
                  "id": "0x3", "class": "UILabel", "depth": 2,
                  "frame": { "x": 10, "y": 10, "w": 100, "h": 20 },
                  "absFrame": { "x": 34, "y": 310, "w": 100, "h": 20 },
                  "text": "Sign In", "children": []
                }
              ]
            }
          ]
        }
      ]
    }
  }
  """

private func decode(_ json: String) throws -> JSONValue {
  try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
}

@Suite("Inspection normalize")
struct InspectionNormalizeTests {
  @Test("a lone window becomes the root with its fields carried over")
  func singleWindow() throws {
    let capture = Inspection.normalize(try decode(rawCapture))
    #expect(capture.hierarchy.id == "0x1")
    #expect(capture.hierarchy.className == "UIWindow")
    #expect(capture.nodeCount == 3)
    #expect(capture.device == Inspection.Device(deviceId: "RAW-IPHONE-16", platform: "ios", width: 390, height: 844))
    #expect(capture.screenshot != nil)

    let button = try #require(capture.hierarchy.children.first)
    #expect(button.title == "Sign In")
    #expect(button.backgroundColor == "#007AFFFF")
    #expect(button.accessibilityIdentifier == "btn_sign_in")
    #expect(button.absFrame == Inspection.Frame(x: 24, y: 300, w: 342, h: 50))
    #expect(button.enabled == false)
    #expect(button.font?.bold == true)
    #expect(button.font?.size == 17)
    #expect(button.rn?.testID == "sign-in")
    #expect(button.depth == 1)
  }

  @Test("several windows wrap under a synthetic root sized to the device")
  func multipleWindows() throws {
    let raw = try decode(
      """
      {
        "capturedAt": "x",
        "device": { "platform": "ios", "deviceId": "sim", "width": 390, "height": 844 },
        "inspect": { "windows": [
          { "id": "0xA", "class": "UIWindow", "frame": { "x": 0, "y": 0, "w": 390, "h": 844 } },
          { "id": "0xB", "class": "UITextEffectsWindow" }
        ] }
      }
      """)
    let capture = Inspection.normalize(raw)
    #expect(capture.hierarchy.id == "windows")
    #expect(capture.hierarchy.rect == Inspection.Frame(x: 0, y: 0, w: 390, h: 844))
    #expect(capture.hierarchy.children.map(\.id) == ["0xA", "0xB"])
    // No `nodeCount` on the wire: counted, synthetic root included.
    #expect(capture.nodeCount == 3)
    #expect(capture.screenshot == nil)
  }

  @Test("a garbled payload yields an empty root rather than failing")
  func garbled() throws {
    let capture = Inspection.normalize(try decode(#"{ "inspect": { "windows": [1, "x", null] } }"#))
    #expect(capture.hierarchy.id == "windows")
    #expect(capture.hierarchy.children.isEmpty)
    #expect(capture.nodeCount == 1)
  }

  @Test("missing ids, classes and frames get defaults")
  func defaults() throws {
    let capture = Inspection.normalize(
      try decode(#"{ "device": {}, "inspect": { "windows": [{ "children": [{}] }] } }"#))
    let root = capture.hierarchy
    #expect(root.id == "node_0_1")
    #expect(root.className == "UIView")
    #expect(root.frame == .zero)
    #expect(root.absFrame == nil)
    #expect(root.children.first?.depth == 1)
  }
}

@Suite("Inspection tree")
struct InspectionTreeTests {
  private func capture() throws -> Inspection.Capture {
    Inspection.normalize(try decode(rawCapture))
  }

  @Test("finds, paths and parents by opaque id")
  func walks() throws {
    let root = try capture().hierarchy
    #expect(root.flattened().map(\.id) == ["0x1", "0x2", "0x3"])
    #expect(root.find("0x3")?.className == "UILabel")
    #expect(root.find("nope") == nil)
    #expect(root.path(to: "0x3").map(\.id) == ["0x1", "0x2", "0x3"])
    #expect(root.path(to: "nope").isEmpty)
    let parents = root.parentMap()
    #expect(Inspection.ancestors(of: "0x3", in: parents) == ["0x2", "0x1"])
    #expect(Inspection.withAncestors(["0x3"], in: parents) == ["0x1", "0x2", "0x3"])
  }

  @Test("search matches class, text and identifiers and steps with wrap-around")
  func search() throws {
    let root = try capture().hierarchy
    #expect(root.searchMatches("sign in").map(\.id) == ["0x2", "0x3"])
    #expect(root.searchMatches("BTN_").map(\.id) == ["0x2"])
    #expect(root.searchMatches("uilabel").map(\.id) == ["0x3"])
    #expect(root.searchMatches("   ").isEmpty)

    let hits = root.searchMatches("sign")
    #expect(Inspection.step(hits, from: nil, forward: true) == "0x2")
    #expect(Inspection.step(hits, from: nil, forward: false) == "0x3")
    #expect(Inspection.step(hits, from: "0x3", forward: true) == "0x2")
    #expect(Inspection.step(hits, from: "0x2", forward: false) == "0x3")
    #expect(Inspection.step([], from: "0x2", forward: true) == nil)
  }

  @Test("hit-testing returns every node under the point, outermost first")
  func hitTest() throws {
    let root = try capture().hierarchy
    #expect(root.nodes(containingX: 40, y: 315).map(\.id) == ["0x1", "0x2", "0x3"])
    #expect(root.nodes(containingX: 200, y: 340).map(\.id) == ["0x1", "0x2"])
    #expect(root.nodes(containingX: 5, y: 5).map(\.id) == ["0x1"])
    #expect(root.nodes(containingX: 500, y: 5).isEmpty)
  }

  @Test("visible rows follow the expansion set")
  func rows() throws {
    let root = try capture().hierarchy
    #expect(root.visibleRows(expanded: []).map(\.node.id) == ["0x1"])
    let open = root.visibleRows(expanded: ["0x1", "0x2"])
    #expect(open.map(\.node.id) == ["0x1", "0x2", "0x3"])
    #expect(open.map(\.level) == [0, 1, 2])
  }

  @Test("hints prefer text, then identifiers, images and opaque fills")
  func hints() {
    var node = Inspection.Node(id: "a", className: "UIView", frame: .zero, depth: 0)
    #expect(node.hint() == nil)
    node.backgroundColor = "#FF000000"
    #expect(node.hint() == nil)
    node.backgroundColor = "#FF0000FF"
    #expect(node.hint() == "#FF0000FF")
    node.accessibilityIdentifier = "row"
    #expect(node.hint() == "#row")
    node.text = "A rather long label that keeps on going"
    #expect(node.hint(maxLength: 10) == "\"A rather …\"")
  }

  @Test("coordinates format to two decimals without trailing zeros")
  func format() {
    #expect(Inspection.format(12) == "12")
    #expect(Inspection.format(12.5) == "12.5")
    #expect(Inspection.format(1.006) == "1.01")
    #expect(Inspection.format(.nan) == "0")
  }

  @Test("colors round-trip through the bridge's hex format")
  func colors() {
    let blue = Inspection.RGBA(hex: "#007AFFFF")
    #expect(blue?.hex == "#007AFFFF")
    #expect(Inspection.RGBA(hex: "FF0000")?.alpha == 1)
    #expect(Inspection.RGBA(hex: "#FF000080")?.hex == "#FF000080")
    #expect(Inspection.RGBA(hex: "nope") == nil)
    #expect(Inspection.RGBA(red: 2, green: 0, blue: 0, alpha: -1).hex == "#FF000000")
  }
}
