import ArgusCore
import ArgusKit
import Foundation
import Testing

@testable import Argus

/// The host's copy wins, this app fills in what it lacks, and changes go back.
@MainActor
struct HostPreferencesTests {
  private final class FakeHost {
    var settings: [String: JSONValue] = [:]
    var ui: [String: String] = [:]
    var settingWrites = 0

    var io: HostPreferences.IO {
      .init(
        getSettings: { self.settings },
        setSettings: { patch in
          self.settingWrites += 1
          self.settings.merge(patch) { $1 }
        },
        getUiState: { self.ui[$0] },
        setUiState: { self.ui[$0] = $1 })
    }
  }

  @MainActor private struct Fixture {
    let defaults: UserDefaults
    let suite: String
    let home: HomeDefaults
    let homeDir: URL
    let prefs: AppPreferences
    let sync: HostPreferences

    init() {
      suite = "argus-host-prefs-\(UUID().uuidString)"
      defaults = UserDefaults(suiteName: suite)!
      homeDir = FileManager.default.temporaryDirectory.appendingPathComponent(suite)
      home = HomeDefaults(file: homeDir.appendingPathComponent("mac-app-state.plist"))
      prefs = AppPreferences(defaults: defaults)
      sync = HostPreferences(bindings: HostPreferences.desktopBindings(prefs: prefs, defaults: defaults, home: home))
    }

    func cleanUp() {
      sync.detach()
      defaults.removePersistentDomain(forName: suite)
      try? FileManager.default.removeItem(at: homeDir)
    }
  }

  @Test func takesTheHostsValues() async {
    let f = Fixture()
    defer { f.cleanUp() }
    let host = FakeHost()
    host.settings = [
      "theme": .string("dark"), "ui_scale": .string("large"), "telemetry_mode": .string("full"),
      "git_diff_layout": .string("unified"),
      "custom_editors": .array([.object(["id": .string("e"), "name": .string("Zed"), "command": .string("zed")])]),
    ]
    host.ui = [
      "runtime.ios_by_session": #"{"s1":"UDID"}"#,
      "home.recent_projects": #"[{"path":"/a","lastOpened":5}]"#,
    ]

    let supplied = await f.sync.attach(host.io)

    #expect(f.prefs.theme == .dark)
    #expect(f.prefs.displaySize == .large)
    #expect(f.prefs.customEditors.map(\.command) == ["zed"])
    #expect(f.defaults.string(forKey: "telemetryMode") == "full")
    #expect(f.defaults.string(forKey: GitPreferences.diffLayoutKey) == "inline")
    #expect(f.home.dictionary(forKey: RuntimeModel.Keys.ios) as? [String: String] == ["s1": "UDID"])
    #expect(HomeRecents.entries(from: f.home.array(forKey: HomeRecents.openedKey) ?? []) == [.init(path: "/a", lastOpened: 5)])
    // Theme, display size, permission mode and model always have a value here.
    #expect(supplied == 2)
    #expect(host.settings["default_permission_mode"] == .string("auto"))
  }

  @Test func handsTheHostWhatItLacks() async {
    let f = Fixture()
    defer { f.cleanUp() }
    f.defaults.set("Tree", forKey: GitPreferences.fileViewModeKey)
    f.home.set(["/hidden"], forKey: HomeRecents.hiddenKey)
    let host = FakeHost()

    await f.sync.attach(host.io)

    #expect(host.settings["git_file_view"] == .string("tree"))
    #expect(host.ui["home.hidden_projects"].flatMap(HostPreferences.decode) == .array([.string("/hidden")]))
  }

  @Test func writesChangesThrough() async {
    let f = Fixture()
    defer { f.cleanUp() }
    let host = FakeHost()
    await f.sync.attach(host.io)
    let writes = host.settingWrites

    f.prefs.theme = .light
    f.sync.localChanged()
    await f.sync.flush()

    #expect(host.settings["theme"] == .string("light"))
    #expect(host.settingWrites == writes + 1)

    f.sync.localChanged()
    await f.sync.flush()
    #expect(host.settingWrites == writes + 1)
  }

  @Test func leavesAnElectronOnlyPickAlone() async {
    let f = Fixture()
    defer { f.cleanUp() }
    let host = FakeHost()
    host.ui["runtime.platform"] = #""video""#
    f.home.set("android", forKey: RuntimeModel.Keys.platform)

    await f.sync.attach(host.io)
    f.sync.localChanged()
    await f.sync.flush()

    #expect(f.home.string(forKey: RuntimeModel.Keys.platform) == "android")
    #expect(host.ui["runtime.platform"] == #""video""#)
  }
}
