#if os(macOS)
  import Darwin
  import Foundation
  import Testing

  @testable import ArgusCore

  /// Drives the real Node host (`pnpm build:host`); skipped without one.
  @MainActor
  @Suite(.serialized)
  struct HostSupervisorTests {
    nonisolated static let repoRoot = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    nonisolated static let hostJS = repoRoot.appendingPathComponent("dist-host/argus-host.js")

    nonisolated static func nodePath() -> String? {
      [
        ProcessInfo.processInfo.environment["ARGUS_TEST_NODE"],
        "\(NSHomeDirectory())/.local/share/mise/installs/node/24/bin/node",
        "/opt/homebrew/bin/node",
      ].compactMap { $0 }.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    nonisolated static var runnable: Bool {
      FileManager.default.fileExists(atPath: hostJS.path) && nodePath() != nil
    }

    func makeHome() throws -> URL {
      let home = URL(fileURLWithPath: "/tmp/argus-hs-\(UUID().uuidString.prefix(8))")
      try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
      return home
    }

    func supervisor(home: URL) -> HostSupervisor {
      HostSupervisor(
        configuration: .init(
          node: URL(fileURLWithPath: Self.nodePath()!), hostScript: Self.hostJS,
          resources: nil, home: home))
    }

    func waitFor(
      _ supervisor: HostSupervisor, timeout: Duration = .seconds(30),
      _ predicate: (HostSupervisor.State) -> Bool
    ) async -> Bool {
      let deadline = ContinuousClock.now + timeout
      while !predicate(supervisor.state) {
        if ContinuousClock.now >= deadline { return false }
        try? await Task.sleep(for: .milliseconds(100))
      }
      return true
    }

    @Test(.enabled(if: runnable))
    func startsRestartsAfterACrashAndStops() async throws {
      let home = try makeHome()
      defer { try? FileManager.default.removeItem(at: home) }
      let supervisor = supervisor(home: home)
      var events: [String] = []
      supervisor.onEvent = { events.append("\($0)") }

      supervisor.start()
      #expect(await waitFor(supervisor) { $0 == .running })
      let first = try #require(HostLock.read(home: home))
      #expect(first.owner == .mac)
      #expect(first.ownerPid == getpid())

      kill(first.pid, SIGKILL)
      #expect(await waitFor(supervisor) { if case .restarting = $0 { true } else { false } })
      #expect(await waitFor(supervisor) { $0 == .running })
      #expect(HostLock.read(home: home)?.pid != first.pid)

      await supervisor.stop()
      #expect(supervisor.state == .stopped)
      #expect(HostLock.read(home: home) == nil)
      #expect(!FileManager.default.fileExists(atPath: supervisor.configuration.socketPath))
      #expect(events.contains { $0.hasPrefix("crashed") })
      let log = try String(contentsOf: supervisor.configuration.logFile, encoding: .utf8)
      #expect(log.contains("UI socket:"))
    }

    @Test(.enabled(if: runnable))
    func reportsAnotherHolderAndTakesOver() async throws {
      let home = try makeHome()
      defer { try? FileManager.default.removeItem(at: home) }

      // Another app's host: a live process holding the lock.
      let other = Process()
      other.executableURL = URL(fileURLWithPath: "/bin/sleep")
      other.arguments = ["60"]
      try other.run()
      defer { if other.isRunning { other.terminate() } }
      let record = HostLockRecord(
        pid: other.processIdentifier, ownerPid: other.processIdentifier, owner: .electron,
        startedAt: 0)
      try JSONEncoder().encode(record).write(to: HostLock.path(home: home))

      let supervisor = supervisor(home: home)
      supervisor.start()
      #expect(supervisor.state == .locked(record))

      // The holder exits on SIGTERM; the lock it leaves behind is then stale.
      supervisor.takeOver()
      #expect(await waitFor(supervisor) { $0 == .running })
      #expect(!other.isRunning)
      await supervisor.stop()
    }
  }
#endif
