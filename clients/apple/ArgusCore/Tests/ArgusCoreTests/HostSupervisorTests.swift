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

    /// A live stand-in for another app's host, advertising `socket` in the lock.
    func holder(home: URL, socket: String?, owner: HostLockRecord.Owner = .electron) throws
      -> (Process, HostLockRecord)
    {
      let other = Process()
      other.executableURL = URL(fileURLWithPath: "/bin/sleep")
      other.arguments = ["60"]
      try other.run()
      let record = HostLockRecord(
        pid: other.processIdentifier, ownerPid: other.processIdentifier, owner: owner,
        startedAt: 0, socket: socket, protocol: socket == nil ? nil : HostLock.uiProtocol)
      try JSONEncoder().encode(record).write(to: HostLock.path(home: home))
      return (other, record)
    }

    func attachOnly(home: URL) -> HostSupervisor {
      HostSupervisor(
        configuration: .init(
          node: URL(fileURLWithPath: "/nonexistent/node"), hostScript: Self.hostJS,
          resources: nil, home: home, attachOnly: true))
    }

    @Test
    func attachesToAnAdvertisedHostAndFollowsItAcrossARestart() async throws {
      let home = try makeHome()
      defer { try? FileManager.default.removeItem(at: home) }
      let supervisor = supervisor(home: home)
      var events: [String] = []
      supervisor.onEvent = { events.append("\($0)") }
      let (first, record) = try holder(home: home, socket: supervisor.configuration.socketPath)

      supervisor.start()
      #expect(supervisor.state == .attached(record))
      #expect(supervisor.isConnected)

      // It quits: this app says so and never starts a host behind its back.
      first.terminate()
      first.waitUntilExit()
      #expect(await waitFor(supervisor, timeout: .seconds(5)) { if case .holderExited = $0 { true } else { false } })
      #expect(HostLock.read(home: home) == nil)

      // It comes back: attach again.
      let (second, next) = try holder(home: home, socket: supervisor.configuration.socketPath)
      defer { second.terminate() }
      #expect(await waitFor(supervisor, timeout: .seconds(5)) { $0 == .attached(next) })
      await supervisor.stop()
      #expect(second.isRunning)
      #expect(events.filter { $0.hasPrefix("attached") }.count == 2)
    }

    @Test
    func attachesOnceAHolderAdvertisesItsSocket() async throws {
      let home = try makeHome()
      defer { try? FileManager.default.removeItem(at: home) }
      let supervisor = supervisor(home: home)
      let (other, record) = try holder(home: home, socket: nil)
      defer { other.terminate() }

      supervisor.start()
      #expect(supervisor.state == .locked(record))

      var advertised = record
      advertised.socket = supervisor.configuration.socketPath
      advertised.protocol = HostLock.uiProtocol
      try JSONEncoder().encode(advertised).write(to: HostLock.path(home: home))
      #expect(await waitFor(supervisor, timeout: .seconds(5)) { $0 == .attached(advertised) })
      await supervisor.stop()
      #expect(other.isRunning)
    }

    @Test
    func neverAttachesToASocketElsewhereOrAnotherProtocol() throws {
      let home = try makeHome()
      defer { try? FileManager.default.removeItem(at: home) }
      let supervisor = supervisor(home: home)
      let (other, record) = try holder(home: home, socket: "/tmp/elsewhere.sock")
      defer { other.terminate() }
      #expect(!supervisor.canAttach(record))
      var newer = record
      newer.socket = supervisor.configuration.socketPath
      newer.protocol = HostLock.uiProtocol + 1
      #expect(!supervisor.canAttach(newer))
    }

    @Test
    func attachOnlyWaitsForAHostAndNeverTakesOne() async throws {
      let home = try makeHome()
      defer { try? FileManager.default.removeItem(at: home) }
      let supervisor = attachOnly(home: home)

      supervisor.start()
      #expect(supervisor.state == .waitingForHost)
      #expect(!FileManager.default.fileExists(atPath: HostLock.path(home: home).path))

      // A holder without a socket: shown, but never taken over or signalled.
      let (other, record) = try holder(home: home, socket: nil, owner: .mac)
      defer { other.terminate() }
      #expect(await waitFor(supervisor, timeout: .seconds(5)) { $0 == .locked(record) })
      supervisor.takeOver()
      #expect(supervisor.state == .locked(record))
      try await Task.sleep(for: .milliseconds(300))
      #expect(other.isRunning)
      await supervisor.stop()
      #expect(other.isRunning)
      #expect(HostLock.read(home: home) == record)
    }
  }
#endif
