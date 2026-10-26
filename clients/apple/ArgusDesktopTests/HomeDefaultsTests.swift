import ArgusCore
import Foundation
import Testing

@testable import Argus

@MainActor
struct HomeDefaultsTests {
  private func tempHome() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent("argus-home-defaults-\(UUID().uuidString)")
  }

  @Test func keepsValuesAcrossLaunches() throws {
    let home = tempHome()
    defer { try? FileManager.default.removeItem(at: home) }
    let file = home.appendingPathComponent("mac-app-state.plist")

    let first = HomeDefaults(file: file)
    first.set("android", forKey: "runtime.platform")
    first.set(["s1": "udid-1"], forKey: "runtime.iosBySession")
    first.set(["/repo"], forKey: "home.hiddenProjects")

    let second = HomeDefaults(file: file)
    #expect(second.string(forKey: "runtime.platform") == "android")
    #expect(second.dictionary(forKey: "runtime.iosBySession") as? [String: String] == ["s1": "udid-1"])
    #expect(second.stringArray(forKey: "home.hiddenProjects") == ["/repo"])

    second.removeObject(forKey: "runtime.platform")
    #expect(HomeDefaults(file: file).string(forKey: "runtime.platform") == nil)
  }

  @Test func twoHomesNeverShareState() {
    let a = tempHome()
    let b = tempHome()
    defer {
      try? FileManager.default.removeItem(at: a)
      try? FileManager.default.removeItem(at: b)
    }
    HomeDefaults(file: a.appendingPathComponent("mac-app-state.plist")).set("web", forKey: "runtime.platform")
    #expect(HomeDefaults(file: b.appendingPathComponent("mac-app-state.plist")).string(forKey: "runtime.platform") == nil)
  }

  @Test func aRestoredBrowserPickDoesNotStartTheBrowser() {
    let home = tempHome()
    defer { try? FileManager.default.removeItem(at: home) }
    let defaults = HomeDefaults(file: home.appendingPathComponent("mac-app-state.plist"))
    defaults.set("web", forKey: "runtime.platform")

    let runtime = RuntimeModel(store: HostStore(), defaults: defaults)
    #expect(runtime.platform == .web)
    #expect(runtime.startedBrowsers.isEmpty)

    runtime.select(platform: .web, device: nil, session: "s1")
    #expect(runtime.startedBrowsers == ["s1"])
  }

  @Test func theDeviceTabKeepsTheLastDevicePlatformWhileTheBrowserIsPicked() {
    let home = tempHome()
    defer { try? FileManager.default.removeItem(at: home) }
    let runtime = RuntimeModel(store: HostStore(), defaults: HomeDefaults(file: home.appendingPathComponent("x.plist")))
    runtime.select(platform: .android, device: nil, session: "s1")
    runtime.select(platform: .web, device: nil, session: "s1")
    #expect(runtime.devicePlatform == .android)
    let reopened = RuntimeModel(store: HostStore(), defaults: HomeDefaults(file: home.appendingPathComponent("x.plist")))
    #expect(reopened.platform == .web)
    #expect(reopened.devicePlatform == .android)
  }

  @Test func aFreshHomeDefaultsToIOS() {
    let home = tempHome()
    defer { try? FileManager.default.removeItem(at: home) }
    let runtime = RuntimeModel(store: HostStore(), defaults: HomeDefaults(file: home.appendingPathComponent("x.plist")))
    #expect(runtime.platform == .ios)
  }
}
