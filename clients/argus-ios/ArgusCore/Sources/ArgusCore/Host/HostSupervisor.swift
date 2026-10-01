#if os(macOS)
  import Darwin
  import Foundation
  import Observation

  /// Runs the bundled Node host: launches it on `ARGUS_HOME`, waits for its UI
  /// socket, restarts it with backoff when it crashes, streams its output to
  /// `logs/host.log`, and stops it cleanly on quit.
  ///
  /// Never starts a second host on a home someone else holds — it reports the
  /// holder instead, and only takes over when asked to.
  @MainActor
  @Observable
  public final class HostSupervisor {
    public struct Configuration: Sendable {
      public var node: URL
      public var hostScript: URL
      /// `ARGUS_RESOURCES`: sim-bridge, conductor, prompts… nil in a checkout.
      public var resources: URL?
      public var home: URL
      /// Extra environment for the host (on top of this process's).
      public var environment: [String: String]

      public init(
        node: URL, hostScript: URL, resources: URL?, home: URL,
        environment: [String: String] = [:]
      ) {
        self.node = node
        self.hostScript = hostScript
        self.resources = resources
        self.home = home
        self.environment = environment
      }

      public var socketPath: String { home.appendingPathComponent("host.sock").path }
      public var logFile: URL { home.appendingPathComponent("logs/host.log") }
    }

    public enum State: Equatable, Sendable {
      case idle
      case starting
      case running
      /// Another app's host is on this home.
      case locked(HostLockRecord)
      /// Waiting for the other app to quit.
      case handingOver(HostLockRecord)
      case restarting(attempt: Int)
      case failed(String)
      case stopped
    }

    /// What happened, for telemetry. Never carries paths or output.
    public enum Event: Sendable {
      case started(restarts: Int)
      case crashed(exitCode: Int32, attempt: Int)
      case gaveUp(crashes: Int)
      case lockConflict(holder: HostLockRecord.Owner)
      case handover(holder: HostLockRecord.Owner, success: Bool)
    }

    /// The host's exit code when someone else holds the lock.
    static let exitLocked: Int32 = 75
    /// Crashes within `crashWindow` before giving up.
    static let maxCrashes = 5
    static let crashWindow: Duration = .seconds(120)
    static let maxLogBytes = 10 * 1024 * 1024

    public private(set) var state: State = .idle
    public let configuration: Configuration
    public var onEvent: (@MainActor (Event) -> Void)?

    private var process: Process?
    private var crashes: [ContinuousClock.Instant] = []
    private var restarts = 0
    private var stopping = false
    private var log: LogSink?

    public init(configuration: Configuration) {
      self.configuration = configuration
    }

    /// Bring the host up, unless another app holds the home.
    public func start() {
      stopping = false
      if let holder = HostLock.read(home: configuration.home) {
        // An orphan of a previous run of this app: its supervisor is gone, so
        // nobody else will ever stop it.
        if holder.owner == .mac, !HostLock.isAlive(holder.ownerPid) {
          kill(holder.pid, SIGTERM)
          state = .starting
          Task {
            _ = await HostLock.waitForRelease(home: configuration.home, timeout: .seconds(15))
            launch()
          }
          return
        }
        if holder.ownerPid != getpid() {
          state = .locked(holder)
          onEvent?(.lockConflict(holder: holder.owner))
          return
        }
      }
      launch()
    }

    /// Ask the app holding the home to quit, then start ours.
    public func takeOver() {
      guard case .locked(let holder) = state else { return }
      state = .handingOver(holder)
      HostLock.askToQuit(holder)
      Task {
        let released = await HostLock.waitForRelease(
          home: configuration.home, timeout: .seconds(30))
        onEvent?(.handover(holder: holder.owner, success: released))
        if released {
          launch()
        } else {
          state = .locked(HostLock.read(home: configuration.home) ?? holder)
        }
      }
    }

    /// SIGTERM, then wait for the host's own shutdown; SIGKILL past `timeout`.
    public func stop(timeout: Duration = .seconds(15)) async {
      stopping = true
      guard let process, process.isRunning else {
        state = .stopped
        return
      }
      process.terminate()
      let deadline = ContinuousClock.now + timeout
      while process.isRunning, ContinuousClock.now < deadline {
        try? await Task.sleep(for: .milliseconds(100))
      }
      if process.isRunning {
        kill(process.processIdentifier, SIGKILL)
      }
      self.process = nil
      state = .stopped
    }

    private func launch() {
      guard !stopping else { return }
      state = restarts == 0 ? .starting : .restarting(attempt: restarts)
      let log = LogSink(file: configuration.logFile, maxBytes: Self.maxLogBytes)
      self.log = log

      let process = Process()
      process.executableURL = configuration.node
      process.arguments = [
        configuration.hostScript.path, "--desktop",
        "--ui-socket", configuration.socketPath,
        "--owner-pid", String(getpid()),
      ]
      var environment = ProcessInfo.processInfo.environment
      environment["ARGUS_HOME"] = configuration.home.path
      if let resources = configuration.resources {
        environment["ARGUS_RESOURCES"] = resources.path
      }
      environment.merge(configuration.environment) { $1 }
      process.environment = environment
      process.currentDirectoryURL = configuration.home

      let output = Pipe()
      process.standardOutput = output
      process.standardError = output
      output.fileHandleForReading.readabilityHandler = { [weak self] handle in
        let data = handle.availableData
        guard !data.isEmpty else {
          handle.readabilityHandler = nil
          return
        }
        log.write(data)
        if String(decoding: data, as: UTF8.self).contains("UI socket: ") {
          Task { @MainActor in self?.didBecomeReady() }
        }
      }
      process.terminationHandler = { [weak self] finished in
        let code = finished.terminationStatus
        Task { @MainActor in self?.didExit(code) }
      }

      do {
        try process.run()
        self.process = process
      } catch {
        state = .failed("Couldn't start the Argus host: \(error.localizedDescription)")
      }
    }

    private func didBecomeReady() {
      guard state != .running else { return }
      state = .running
      onEvent?(.started(restarts: restarts))
    }

    private func didExit(_ code: Int32) {
      process = nil
      guard !stopping else {
        state = .stopped
        return
      }
      if code == Self.exitLocked, let holder = HostLock.read(home: configuration.home) {
        state = .locked(holder)
        onEvent?(.lockConflict(holder: holder.owner))
        return
      }
      let now = ContinuousClock.now
      crashes = crashes.filter { now - $0 < Self.crashWindow } + [now]
      restarts += 1
      onEvent?(.crashed(exitCode: code, attempt: restarts))
      if crashes.count >= Self.maxCrashes {
        onEvent?(.gaveUp(crashes: crashes.count))
        state = .failed(
          "The Argus host keeps crashing. Its log is at \(configuration.logFile.path).")
        return
      }
      state = .restarting(attempt: restarts)
      // 0.5 s, doubling per recent crash, capped at 8 s.
      let delay = Duration.milliseconds(500 * (1 << min(crashes.count - 1, 4)))
      Task {
        try? await Task.sleep(for: delay)
        launch()
      }
    }

    /// Clear a `failed` state and try again from scratch.
    public func retry() {
      crashes = []
      start()
    }
  }

  /// Appends host output to a log file, rolling it to `.1` past `maxBytes`.
  final class LogSink: @unchecked Sendable {
    private let file: URL
    private let maxBytes: Int
    private let lock = NSLock()

    init(file: URL, maxBytes: Int) {
      self.file = file
      self.maxBytes = maxBytes
      try? FileManager.default.createDirectory(
        at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    }

    func write(_ data: Data) {
      lock.lock()
      defer { lock.unlock() }
      let manager = FileManager.default
      if let size = try? manager.attributesOfItem(atPath: file.path)[.size] as? Int,
        size + data.count > maxBytes
      {
        let rolled = file.appendingPathExtension("1")
        try? manager.removeItem(at: rolled)
        try? manager.moveItem(at: file, to: rolled)
      }
      if !manager.fileExists(atPath: file.path) {
        manager.createFile(atPath: file.path, contents: nil)
      }
      guard let handle = try? FileHandle(forWritingTo: file) else { return }
      defer { try? handle.close() }
      _ = try? handle.seekToEnd()
      try? handle.write(contentsOf: data)
    }
  }
#endif
