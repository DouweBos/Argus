import ArgusCore
import ArgusKit
import Foundation
import Testing

@MainActor
@Suite("Design viewer")
struct DesignViewerModelTests {
  private static let login = "https://www.figma.com/design/k/App?node-id=1-2"
  private static let signup = "https://www.figma.com/design/k/?node-id=3-4"

  private static func details(node: String, name: String, version: String) -> String {
    #"""
    {"details":{"ref":{"url":"u","fileKey":"k","nodeId":"\#(node)","name":"\#(name)","version":"\#(version)"},
     "frame":{"name":"\#(name)","image":"aGk=","width":390,"height":844},
     "layers":[{"id":"1:3","name":"Title","type":"TEXT","depth":1,"x":0,"y":0,"width":200,"height":24,
       "text":"Welcome","fill":"#111111","font":"Inter 600 16/24"}],
     "comments":[{"author":"Ann","body":"Bigger"}],
     "file":{"name":"App","version":"\#(version)","lastModified":1700000000000},
     "pages":[{"name":"Screens","frames":[{"name":"Login","url":"\#(login)"},{"name":"Sign up","url":"\#(signup)"}]}]}}
    """#
  }

  private func model(sessionVersion: String? = nil) async -> (DesignViewerModel, RecordingBackend, HostStore) {
    let store = HostStore()
    let backend = RecordingBackend()
    await store.attach(backend)
    backend.reply("figma.frame_details", Self.details(node: "1:2", name: "Login", version: "8"))
    return (DesignViewerModel(url: Self.login, sessionVersion: sessionVersion, host: store), backend, store)
  }

  @Test("loads the frame and decodes its image")
  func loads() async {
    let (model, _, store) = await model()
    await model.load()

    #expect(model.details?.layers.first?.text == "Welcome")
    #expect(model.image == Data("hi".utf8))
    #expect(model.isCurrent(Self.login))
    #expect(!model.isCurrent(Self.signup))
    #expect(!model.designChanged)
    withExtendedLifetime(store) {}
  }

  @Test("tells when the design moved on since the session captured it")
  func designChanged() async {
    let (model, _, store) = await model(sessionVersion: "7")
    await model.load()
    #expect(model.designChanged)

    let (same, _, other) = await self.model(sessionVersion: "8")
    await same.load()
    #expect(!same.designChanged)
    withExtendedLifetime((store, other)) {}
  }

  @Test("moves to another frame and back")
  func navigates() async {
    let (model, backend, store) = await model()
    await model.load()
    backend.reply("figma.frame_details", Self.details(node: "3:4", name: "Sign up", version: "8"))

    await model.open(Self.signup)
    #expect(model.details?.frame.name == "Sign up")
    #expect(model.history == [Self.login])

    backend.reply("figma.frame_details", Self.details(node: "1:2", name: "Login", version: "8"))
    await model.back()
    #expect(model.url == Self.login)
    #expect(model.history.isEmpty)
    withExtendedLifetime(store) {}
  }

  @Test("says so when the link isn't a frame")
  func notAFrame() async {
    let (model, backend, store) = await model()
    backend.reply("figma.frame_details", #"{"details":null}"#)
    await model.load()

    #expect(model.details == nil)
    #expect(model.loadError != nil)
    withExtendedLifetime(store) {}
  }

  @Test("compares against the picked device")
  func compares() async {
    let (model, backend, store) = await model()
    backend.reply(
      "design.compare",
      #"{"comparison":{"differingFraction":0.126,"width":2,"height":2,"design":"aGk=","screenshot":"aGk=","diff":"aGk="}}"#)

    await model.compare(with: DesignCompareTarget(platform: .ios, deviceKey: "UDID", name: "iPhone"))

    #expect(model.differingPercent == 13)
    #expect(
      backend.calls("design.compare").first?.params
        == .object(["url": .string(Self.login), "platform": .string("ios"), "device_key": .string("UDID")]))

    backend.fail("design.compare")
    await model.compare(with: DesignCompareTarget(platform: .ios, deviceKey: "UDID", name: "iPhone"))
    #expect(model.compareError != nil)
    withExtendedLifetime(store) {}
  }

  @Test("selects the layer under a click, and clears on a new frame")
  func selects() async {
    let (model, backend, store) = await model()
    await model.load()
    var sources: [DesignViewerModel.SelectionSource] = []
    model.onFirstSelection = { sources.append($0) }

    model.select(at: CGPoint(x: 5, y: 5))
    #expect(model.selectedLayer?.name == "Title")
    model.select(at: CGPoint(x: 500, y: 5))
    #expect(model.selectedLayerId == nil)
    model.select("1:3", from: .tree)
    #expect(sources == [.canvas])

    backend.reply("figma.frame_details", Self.details(node: "3:4", name: "Sign up", version: "8"))
    await model.open(Self.signup)
    #expect(model.selectedLayerId == nil)
    withExtendedLifetime(store) {}
  }

  @Test("reads the flattened layers back as a tree")
  func layerTree() {
    func layer(_ id: String, _ depth: Double, _ rect: CGRect? = nil) -> ArgusProtocol.FigmaLayer {
      ArgusProtocol.FigmaLayer(
        id: id, name: id, type: "FRAME", depth: depth, x: rect.map { Double($0.minX) }, y: rect.map { Double($0.minY) }, width: rect.map { Double($0.width) },
        height: rect.map { Double($0.height) })
    }
    let tree = DesignLayerTree([
      layer("root", 0, CGRect(x: 0, y: 0, width: 100, height: 100)),
      layer("card", 1, CGRect(x: 10, y: 10, width: 50, height: 50)),
      layer("icon", 2, CGRect(x: 20, y: 20, width: 10, height: 10)),
      layer("label", 1, CGRect(x: 40, y: 40, width: 40, height: 10)),
      layer("ghost", 1),
    ])

    #expect(tree.ancestors(of: "icon") == ["card", "root"])
    #expect(tree.hasChildren("card"))
    #expect(!tree.hasChildren("label"))
    #expect(tree.visible(collapsed: ["card"]).map(\.id) == ["root", "card", "label", "ghost"])
    #expect(tree.hit(CGPoint(x: 25, y: 25))?.id == "icon")
    #expect(tree.hit(CGPoint(x: 45, y: 45))?.id == "label")
    #expect(tree.hit(CGPoint(x: 90, y: 90))?.id == "root")
    #expect(tree.hit(CGPoint(x: 200, y: 0)) == nil)
  }

  @Test("recognises Figma design links")
  func figmaLinks() {
    #expect(FigmaLink.isDesign("https://www.figma.com/design/k/App?node-id=1-2"))
    #expect(FigmaLink.isDesign("https://figma.com/file/k/App"))
    #expect(FigmaLink.isDesign("https://www.figma.com/proto/k/App"))
    #expect(!FigmaLink.isDesign("https://www.figma.com/community/plugin/1"))
    #expect(!FigmaLink.isDesign("https://notfigma.com/design/k"))
    #expect(!FigmaLink.isDesign("https://linear.app/x/issue/ENG-1"))
  }
}
