#if os(macOS)
  import Foundation
  import Testing

  @testable import ArgusCore

  struct HostLocationTests {
    let user = URL(fileURLWithPath: "/Users/someone")
    let resources = URL(fileURLWithPath: "/Apps/Argus Server.app/Contents/Resources")

    func server(debug: Bool, env: [String: String] = [:]) -> HostLocation {
      var location = HostLocation.server(isDebug: debug)
      location.environment = env
      location.userHome = user
      location.resources = resources
      return location
    }

    @Test func serverReleaseIsTheElectronServersHomeAndPort() {
      let location = server(debug: false)
      #expect(location.home.path == "/Users/someone/.argus-server")
      #expect(location.port == 47617)
      let config = location.configuration()
      #expect(config.mode == .server)
      #expect(config.environment["ARGUS_REMOTE_PORT"] == "47617")
      #expect(config.hostScript.path == resources.path + "/host/argus-host.js")
      #expect(!config.attachOnly)
    }

    @Test func serverDebugNeverTouchesTheReleaseHome() {
      let location = server(debug: true)
      #expect(location.home.path == "/Users/someone/.argus-mac-server-dev")
      #expect(location.port == 48116)
    }

    @Test func environmentOverridesHomeAndPort() {
      let location = server(debug: true, env: ["ARGUS_HOME": "/tmp/x", "ARGUS_REMOTE_PORT": "49000"])
      #expect(location.home.path == "/tmp/x")
      #expect(location.port == 49000)
      // The host reads the inherited variable itself.
      #expect(location.configuration().environment["ARGUS_REMOTE_PORT"] == nil)
    }

    @Test func serverIgnoresAttachHome() {
      let location = server(debug: true, env: ["ARGUS_ATTACH_HOME": "/tmp/other"])
      #expect(location.attachHome == nil)
      #expect(location.configuration().home.path == "/Users/someone/.argus-mac-server-dev")
    }

    @Test func desktopKeepsItsHomesAndLeavesThePortToSettings() {
      var location = HostLocation.desktop(isDebug: false)
      location.environment = ["ARGUS_ATTACH_HOME": "~/.argus"]
      location.userHome = user
      #expect(location.home.path == "/Users/someone/.argus")
      #expect(location.port == nil)
      let config = location.configuration()
      #expect(config.mode == .desktop)
      #expect(config.attachOnly)
      #expect(config.environment["ARGUS_REMOTE_PORT"] == nil)
      location.isDebug = true
      #expect(location.home.path == "/Users/someone/.argus-mac-dev")
    }

    @MainActor
    @Test func supervisorPassesTheModeFlag() {
      let config = server(debug: true).configuration()
      #expect(config.arguments(ownerPid: 42) == [
        "--max-old-space-size=8192",
        config.hostScript.path, "--server", "--ui-socket", config.socketPath, "--owner-pid", "42",
      ])
      #expect(HostSupervisor.Mode.server.lockOwner == .macServer)
      #expect(HostSupervisor.Mode.desktop.lockOwner == .mac)
    }

    @Test func lockRecordDecodesTheServerOwner() throws {
      let json = #"{"pid":1,"owner_pid":2,"owner":"mac-server","started_at":3}"#
      let record = try JSONDecoder().decode(HostLockRecord.self, from: Data(json.utf8))
      #expect(record.owner == .macServer)
      #expect(record.holderName == "Argus Server")
      let unknown = #"{"pid":1,"owner":"toaster"}"#
      #expect(try JSONDecoder().decode(HostLockRecord.self, from: Data(unknown.utf8)).owner == .cli)
    }
  }
#endif
