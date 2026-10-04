import ArgusCore
import Foundation
import GroveKit

/// GroveKit's runner for a session on a paired host: git and the worktree's
/// files go over the gateway (`git_runner_*` and the session file commands,
/// all admin tier) instead of this Mac's disk.
nonisolated struct GatewayGitRunner: GitRunner {
  let hostId: HostId
  let sessionId: String
  let backend: HostRouter
  /// `<git dir>/argus-scratch` on the host: rebase todo lists and editor
  /// scripts have to be where the host's git can read them.
  let temporaryDirectory: URL
  /// Delivers a host broadcast channel's payloads until the returned closure is called.
  let observe: @Sendable (_ channel: String, _ handler: @escaping @Sendable (JSONValue) -> Void) async -> @Sendable () -> Void

  private static let runTimeout: Duration = .seconds(120)
  private static let streamingTimeout: Duration = .seconds(1800)

  /// Asks the host where the session's git dir and scratch space are.
  static func open(
    hostId: HostId, sessionId: String, backend: HostRouter,
    observe: @escaping @Sendable (String, @escaping @Sendable (JSONValue) -> Void) async -> @Sendable () -> Void
  ) async throws -> (runner: GatewayGitRunner, worktree: URL) {
    let info = try await HostRouter.$pinned.withValue(hostId) {
      try await backend.request(ArgusProtocol.Commands.GitRunnerInfo.self, .init(sessionId: sessionId))
    }
    let runner = GatewayGitRunner(
      hostId: hostId, sessionId: sessionId, backend: backend,
      temporaryDirectory: URL(fileURLWithPath: info.scratchDir, isDirectory: true), observe: observe)
    return (runner, URL(fileURLWithPath: info.worktree, isDirectory: true))
  }

  private func pinned<T: Sendable>(_ work: () async throws -> T) async throws -> T {
    try await HostRouter.$pinned.withValue(hostId) { try await work() }
  }

  // MARK: Git

  func run(_ invocation: GitInvocation) async throws -> ShellResult {
    try await execute(invocation, timeout: Self.runTimeout, onStderr: nil)
  }

  func runStreaming(_ invocation: GitInvocation, onStderr: @escaping @Sendable (String) -> Void)
    async throws -> ShellResult
  {
    try await execute(invocation, timeout: Self.streamingTimeout, onStderr: onStderr)
  }

  private func execute(
    _ invocation: GitInvocation, timeout: Duration, onStderr: (@Sendable (String) -> Void)?
  ) async throws -> ShellResult {
    let runId = UUID().uuidString
    let scope = "git-runner:\(runId)"
    var stopObserving: (@Sendable () -> Void)?
    if let onStderr {
      stopObserving = await observe("git-runner:progress:\(runId)") { payload in
        if case .object(let object) = payload, case .string(let chunk) = object["chunk"] { onStderr(chunk) }
      }
      try await pinned { await backend.subscribe(agentId: scope, on: true) }
    }
    defer {
      stopObserving?()
      if onStderr != nil {
        let backend = backend, hostId = hostId
        Task { await HostRouter.$pinned.withValue(hostId) { await backend.subscribe(agentId: scope, on: false) } }
      }
    }
    let env = invocation.shellEnvironment.merging(invocation.environment) { $1 }
    let params = ArgusProtocol.CommandsTypes.GitRunnerRunParams(
      sessionId: sessionId, args: invocation.arguments, cwd: invocation.workingDirectory.path,
      env: env.isEmpty ? nil : env, stdin: invocation.input?.base64EncodedString(), runId: runId)
    let result = try await withTaskCancellationHandler {
      try await pinned {
        try await backend.request(
          method: ArgusProtocol.Commands.GitRunnerRun.name, params,
          as: ArgusProtocol.GitRunnerRunResult.self, tier: "admin", timeout: timeout)
      }
    } onCancel: {
      let backend = backend, hostId = hostId
      Task {
        try? await HostRouter.$pinned.withValue(hostId) {
          try await backend.request(ArgusProtocol.Commands.GitRunnerCancel.self, .init(runId: runId))
        }
      }
    }
    var stdout = Data(base64Encoded: result.stdout) ?? Data()
    if let outputId = result.outputId {
      stdout = try await page(outputId)
    }
    return try await Self.shellResult(stdout: stdout, stderr: result.stderr, exitCode: Int32(result.exitCode))
  }

  /// Output too big for one frame, a page at a time.
  private func page(_ outputId: String) async throws -> Data {
    var data = Data()
    while true {
      let chunk = try await pinned {
        try await backend.request(
          ArgusProtocol.Commands.GitRunnerOutput.self, .init(outputId: outputId, offset: Double(data.count)))
      }
      data.append(Data(base64Encoded: chunk.data) ?? Data())
      if chunk.done { return data }
    }
  }

  /// GroveKit 0.5.1 has no public `ShellResult` initializer, so a runner outside
  /// it can only get one from `LocalGitRunner`: replay the host's output
  /// through a local `sh`, byte for byte.
  private static func shellResult(stdout: Data, stderr: String, exitCode: Int32) async throws -> ShellResult {
    let replay = LocalGitRunner(gitPath: "/bin/sh")
    return try await replay.run(
      GitInvocation(
        arguments: ["-c", #"cat; printf '%s' "$ARGUS_REPLAY_STDERR" >&2; exit "$ARGUS_REPLAY_EXIT""#],
        workingDirectory: URL(fileURLWithPath: NSTemporaryDirectory()),
        environment: ["ARGUS_REPLAY_STDERR": String(stderr.suffix(64 * 1024)), "ARGUS_REPLAY_EXIT": String(exitCode & 0xFF)],
        input: stdout))
  }

  /// The host picks its own git; GroveKit's default for this is main-actor
  /// isolated, so it's spelled out here.
  func withGitExecutable(_ path: String) -> (any GitRunner)? { nil }

  // MARK: Files

  func itemKind(at url: URL) async -> FileItemKind? {
    let kind = try? await pinned {
      try await backend.request(ArgusProtocol.Commands.StatPath.self, .init(id: sessionId, relativePath: url.path))
    }
    switch kind?.kind.rawValue {
    case "file": return .file
    case "directory": return .directory
    default: return nil
    }
  }

  func readFile(at url: URL) async throws -> Data {
    let base64 = try await pinned {
      try await backend.request(ArgusProtocol.Commands.ReadFileBytes.self, .init(id: sessionId, relativePath: url.path))
    }
    guard let data = Data(base64Encoded: base64) else { throw CocoaError(.fileReadCorruptFile) }
    return data
  }

  func writeFile(_ data: Data, to url: URL, executable: Bool) async throws {
    _ = try await pinned {
      try await backend.request(
        ArgusProtocol.Commands.WriteFileBytes.self,
        .init(id: sessionId, relativePath: url.path, data: data.base64EncodedString(), executable: executable))
    }
  }

  func removeItem(at url: URL) async throws {
    _ = try await pinned {
      try await backend.request(ArgusProtocol.Commands.RemovePath.self, .init(id: sessionId, relativePath: url.path))
    }
  }

  func createDirectory(at url: URL) async throws {
    _ = try await pinned {
      try await backend.request(ArgusProtocol.Commands.MakeDirectory.self, .init(id: sessionId, relativePath: url.path))
    }
  }

  func moveItem(at source: URL, to destination: URL) async throws {
    _ = try await pinned {
      try await backend.request(
        ArgusProtocol.Commands.MovePath.self, .init(id: sessionId, from: source.path, to: destination.path))
    }
  }

  func contentsOfDirectory(at url: URL) async throws -> [String] {
    try await pinned {
      try await backend.request(
        ArgusProtocol.Commands.ListDirectoryNames.self, .init(id: sessionId, relativePath: url.path))
    }
  }
}
