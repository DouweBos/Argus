import Foundation
import Testing

@testable import ArgusKit

/// Drives a real Node host over its local UI socket. Needs a built host —
/// `pnpm build:host` — and is skipped without one, so `swift test` stays
/// self-contained on a fresh checkout.
struct LocalTransportTests {
  static let repoRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  static let hostJS = repoRoot.appendingPathComponent("dist-host/argus-host.js")
  static var hostBuilt: Bool { FileManager.default.fileExists(atPath: hostJS.path) }

  /// `node` from PATH as mise resolves it; tests don't get a login shell.
  static func nodePath() -> String? {
    let candidates = [
      ProcessInfo.processInfo.environment["ARGUS_TEST_NODE"],
      "\(NSHomeDirectory())/.local/share/mise/installs/node/24/bin/node",
      "/opt/homebrew/bin/node",
      "/usr/local/bin/node",
    ].compactMap { $0 }
    return candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
  }

  @Test(.enabled(if: hostBuilt && nodePath() != nil))
  func servesEveryTierOverTheSocket() async throws {
    // Short path: a socket's sun_path tops out around 104 bytes.
    let home = URL(fileURLWithPath: "/tmp/argus-lt-\(UUID().uuidString.prefix(8))")
    try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: home) }

    let host = Process()
    host.executableURL = URL(fileURLWithPath: Self.nodePath()!)
    host.arguments = [Self.hostJS.path, "--desktop"]
    host.environment = ProcessInfo.processInfo.environment.merging([
      "ARGUS_HOME": home.path
    ]) { $1 }
    host.standardOutput = FileHandle.nullDevice
    host.standardError = FileHandle.nullDevice
    try host.run()
    defer {
      host.terminate()
      host.waitUntilExit()
    }

    let socket = home.appendingPathComponent("host.sock").path
    let transport = LocalTransport(path: socket)
    let events = await transport.start()
    var iterator = events.makeAsyncIterator()
    // The socket appears a moment after boot; the transport retries until then.
    while let event = await iterator.next() {
      if case .state(.ready) = event { break }
    }

    let snapshot = try await transport.request(ArgusProtocol.Commands.StateHydrate.self, EmptyParams())
    #expect(snapshot.sessions.isEmpty)

    // A burst: the host drops a request numbered behind one it already read,
    // so each has to leave in the order it was numbered or it times out.
    try await withThrowingTaskGroup(of: Void.self) { group in
      for _ in 0..<64 {
        group.addTask { _ = try await transport.request(ArgusProtocol.Commands.StateHydrate.self, EmptyParams()) }
      }
      try await group.waitForAll()
    }

    // Host tier: only the local console may call it. It comes straight back
    // as a delegated platform request.
    _ = try await transport.request(
      ArgusProtocol.Commands.RevealInFinder.self, .init(path: home.path))
    while let event = await iterator.next() {
      if case .event(let envelope) = event, envelope.event == "platform.request" {
        #expect(envelope.payload["kind"] == .string("reveal_in_finder"))
        #expect(envelope.payload["path"] == .string(home.path))
        break
      }
    }

    // A method this host never had reads as version skew, with its version.
    do {
      _ = try await transport.request(method: "nothing.here", EmptyParams(), as: IgnoredResult.self)
      Issue.record("an unknown method succeeded")
    } catch Transport.TransportError.unsupported(let method, let hostVersion) {
      #expect(method == "nothing.here")
      #expect(hostVersion?.isEmpty == false)
    }

    struct Foreground: Encodable { let foreground: Bool }
    _ = try await transport.request(
      method: "ui.state", Foreground(foreground: true), as: IgnoredResult.self)
    await transport.disconnect()
  }
}
