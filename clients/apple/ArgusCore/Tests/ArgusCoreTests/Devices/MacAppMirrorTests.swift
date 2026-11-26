import ArgusCore
import CoreGraphics
import Foundation
import Testing

@Suite("Mac app mirror")
struct MacAppMirrorTests {
  private func info(
    _ number: Int, pid: Int, owner: String, title: String? = nil, layer: Int = 0, alpha: Double = 1,
    size: CGSize = CGSize(width: 800, height: 600)
  ) -> [String: Any] {
    var info: [String: Any] = [
      "kCGWindowNumber": NSNumber(value: number), "kCGWindowOwnerPID": NSNumber(value: pid),
      "kCGWindowOwnerName": owner, "kCGWindowLayer": NSNumber(value: layer),
      "kCGWindowAlpha": NSNumber(value: alpha),
      "kCGWindowBounds": [
        "X": NSNumber(value: 10), "Y": NSNumber(value: 20), "Width": NSNumber(value: Double(size.width)),
        "Height": NSNumber(value: Double(size.height)),
      ],
    ]
    if let title { info["kCGWindowName"] = title }
    return info
  }

  private let bundles: [Int32: String] = [
    1: "com.apple.TextEdit", 2: "com.apple.calculator", 3: "dev.houwert.argus.mac.dev", 4: "dev.houwert.argus",
  ]

  @Test("offers ordinary app windows, sorted, and never Argus, overlays or slivers")
  func listing() {
    let windows = MacAppWindowList.windows(
      from: [
        info(10, pid: 1, owner: "TextEdit", title: "Notes.txt"),
        info(11, pid: 2, owner: "Calculator", title: "Calculator"),
        info(12, pid: 3, owner: "Argus Dev"),
        info(13, pid: 4, owner: "Argus"),
        info(14, pid: 1, owner: "TextEdit", title: "Menu", layer: 25),
        info(15, pid: 1, owner: "TextEdit", alpha: 0),
        info(16, pid: 1, owner: "TextEdit", size: CGSize(width: 30, height: 30)),
        info(17, pid: 9, owner: "daemon"),
        info(18, pid: 1, owner: "TextEdit", title: "Draft.txt"),
        info(19, pid: 99, owner: "Me"),
      ], ownPid: 99, bundleId: { bundles[$0] })
    #expect(windows.map(\.windowId) == [11, 18, 10])
    #expect(windows.last?.frame == CGRect(x: 10, y: 20, width: 800, height: 600))
    #expect(windows.last?.bundleId == "com.apple.TextEdit")
  }

  @Test("a window with no title yet, before Screen Recording, still lists by its app")
  func untitled() {
    let windows = MacAppWindowList.windows(
      from: [info(10, pid: 1, owner: "TextEdit")], ownPid: 0, bundleId: { bundles[$0] })
    #expect(windows.first?.title == "")
    #expect(windows.first?.appName == "TextEdit")
  }

  @Test("a pick round-trips through its key and falls back to another window of the app")
  func target() {
    let target = MacAppTarget(bundleId: "com.apple.TextEdit", windowId: 10)
    #expect(MacAppTarget(key: target.key) == target)
    #expect(MacAppTarget(key: "nonsense") == nil)
    #expect(MacAppTarget(key: "#12") == nil)
    let other = MacAppWindow(
      windowId: 22, pid: 1, bundleId: "com.apple.TextEdit", appName: "TextEdit", title: "", frame: .zero)
    let calc = MacAppWindow(
      windowId: 10, pid: 2, bundleId: "com.apple.calculator", appName: "Calculator", title: "", frame: .zero)
    // Window ids are global, so the same id in another app is still the pick.
    #expect(target.resolve(in: [other, calc]) == calc)
    #expect(target.resolve(in: [other]) == other)
    #expect(target.resolve(in: []) == nil)
  }

  @Test("Screen Recording blocks the mirror; Accessibility only makes it view-only")
  func permissions() {
    let none = MacAppPermissions(screenRecording: false, accessibility: false)
    #expect(none.blocking == .screenRecording)
    #expect(none.missing == .screenRecording)
    #expect(!none.viewOnly)
    let watch = MacAppPermissions(screenRecording: true, accessibility: false)
    #expect(watch.blocking == nil)
    #expect(watch.viewOnly)
    #expect(watch.missing == .accessibility)
    let both = MacAppPermissions(screenRecording: true, accessibility: true)
    #expect(both.missing == nil)
    #expect(!both.viewOnly)
    #expect(MacAppPermissions.Grant.screenRecording.settingsURL.query == "Privacy_ScreenCapture")
    #expect(MacAppPermissions.Grant.accessibility.rawValue == "accessibility")
  }

  @Test("a click on the letterboxed mirror lands on the same spot of the real window")
  func mapping() {
    let window = CGRect(x: 100, y: 50, width: 800, height: 400)
    // A 2:1 window in a square stage sits in a 400x200 band at y 100.
    let stage = CGSize(width: 400, height: 400)
    #expect(
      MacAppMirrorGeometry.screenPoint(CGPoint(x: 200, y: 200), stage: stage, window: window)
        == CGPoint(x: 500, y: 250))
    #expect(
      MacAppMirrorGeometry.screenPoint(CGPoint(x: 0, y: 100), stage: stage, window: window)
        == CGPoint(x: 100, y: 50))
    #expect(MacAppMirrorGeometry.screenPoint(CGPoint(x: 200, y: 20), stage: stage, window: window) == nil)
  }
}
