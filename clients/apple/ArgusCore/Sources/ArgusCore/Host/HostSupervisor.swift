#if os(macOS)
  import Darwin
  import Foundation
  import Observation

  /// Runs the bundled Node host: launches it on `ARGUS_HOME`, waits for its UI
  /// socket, restarts it with backoff when it crashes, streams its output to
  /// `logs/host.log`, and stops it cleanly on quit.
  ///
  /// Never starts a second host on a home someone else holds: when the holder
  /// advertises its UI socket this app attaches to it as a second window,
  /// otherwise it reports the holder. It only takes over when asked to, and an
  /// attach-only supervisor never launches, takes over or signals anything.
  @MainActor
  @Observable
  public final class HostSupervisor {
    /// Which app the host runs for: the Mac app (`--desktop`) or Argus Server (`--server`).
    public enum Mode: String, Sendable {
      case desktop, server

      var flag: String { "--\(rawValue)" }

      /// The owner the host records in `host.lock` in this mode.
      public var lockOwner: HostLockRecord.Owner {
        switch self {
        case .desktop: .mac
        case .server: .macServer
        }
      }
    }

    public struct Configuration: Sendable {
      public var node: URL
      public var hostScript: URL
      /// `ARGUS_RESOURCES`: sim-bridge, conductor, prompts… nil in a checkout.
      public var resources: URL?
      public var home: URL
      /// Extra environment for the host (on top of this process's).
      public var environment: [String: String]
      /// Only ever a client of whoever runs `home`: never a host of its own.
      public var attachOnly: Bool
      public var mode: Mode

      public init(
        node: URL, hostScript: URL, resources: URL?, home: URL,
        environment: [String: String] = [:], attachOnly: Bool = false, mode: Mode = .desktop
      ) {
        self.node = node
        self.hostScript = hostScript
        self.resources = resources
        self.home = home
        self.environment = environment
        self.attachOnly = attachOnly
        self.mode = mode
      }

      /// What `launch()` passes the host script.
      public func arguments(ownerPid: Int32) -> [String] {
        [
          // Node's ~4 GB default heap OOM-crashed long-running hosts.
          "--max-old-space-size=8192",
          hostScript.path, mode.flag,
          "--ui-socket", socketPath,
          "--owner-pid", String(ownerPid),
        ]
      }

      public var socketPath: String { home.appendingPathComponent("host.sock").path }
      public var logFile: URL { home.appendingPathComponent("logs/host.log") }
    }

    public enum State: Equatable, Sendable {
      case idle
      case starting
      case running
      /// Connected to another app's host as a second window.
      case attached(HostLockRecord)
      /// Another app's host is on this home and can't be attached to.
      case locked(HostLockRecord)
      /// The host this app was attached to went away; reattaches if one returns.
      case holderExited(HostLockRecord)
      /// Attach-only, and nothing runs on this home yet.
      case waitingForHost
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
      case attached(holder: HostLockRecord.Owner)
      case holderExited(holder: HostLockRecord.Owner)
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
    /// Follows the lock while this app is someone else's window, or waits for one.
    private var watch: Task<Void, Never>?
    static let watchInterval: Duration = .milliseconds(750)

    public init(configuration: Configuration) {
      self.configuration = configuration
    }

    /// The host this app is a second window on, if it is one.
    public var attachedTo: HostLockRecord? {
      if case .attached(let holder) = state { holder } else { nil }
    }

    /// A host is up and this app is connected to it, its own or another app's.
    public var isConnected: Bool {
      state == .running || attachedTo != nil
    }

    /// Bring the host up, unless another app holds the home — then attach to it
    /// when it lets us.
    public func start() {
      stopping = false
      if let holder = HostLock.read(home: configuration.home) {
        if canAttach(holder) {
          attach(holder)
          return
        }
        // An orphan of a previous run of this app: its supervisor is gone, so
        // nobody else will ever stop it.
        if !configuration.attachOnly, holder.owner == configuration.mode.lockOwner, !HostLock.isAlive(holder.ownerPid) {
          kill(holder.pid, SIGTERM)
          state = .starting
          Task {
            _ = await HostLock.waitForRelease(home: configuration.home, timeout: .seconds(15))
            launch()
          }
          return
        }
        if holder.ownerPid != getpid() || configuration.attachOnly {
          lock(holder)
          return
        }
      }
      if configuration.attachOnly {
        state = .waitingForHost
        follow()
        return
      }
      launch()
    }

    /// Advertised on our own home's socket, in a protocol we speak.
    func canAttach(_ holder: HostLockRecord) -> Bool {
      guard holder.attachable, let socket = holder.socket, holder.ownerPid != getpid() else {
        return false
      }
      let ours = URL(fileURLWithPath: configuration.socketPath).resolvingSymlinksInPath()
      return URL(fileURLWithPath: socket).resolvingSymlinksInPath() == ours
    }

    /// Someone we can't attach to holds it. Keep watching: Electron advertises
    /// its socket a moment after taking the lock.
    private func lock(_ holder: HostLockRecord) {
      state = .locked(holder)
      onEvent?(.lockConflict(holder: holder.owner))
      follow()
    }

    private func attach(_ holder: HostLockRecord) {
      state = .attached(holder)
      onEvent?(.attached(holder: holder.owner))
      follow()
    }

    /// Track the lock: follow a holder that restarts, notice one that leaves,
    /// and attach to whoever comes up next.
    private func follow() {
      watch?.cancel()
      watch = Task { [weak self] in
        while !Task.isCancelled {
          try? await Task.sleep(for: Self.watchInterval)
          guard let self, !Task.isCancelled else { return }
          self.lockMoved(HostLock.read(home: self.configuration.home))
        }
      }
    }

    private func lockMoved(_ current: HostLockRecord?) {
      switch (state, current) {
      case (.attached(let holder), nil):
        state = .holderExited(holder)
        onEvent?(.holderExited(holder: holder.owner))
      case (.attached(let holder), let next?) where next.pid != holder.pid || next.socket != holder.socket:
        if canAttach(next) { attach(next) } else { lock(next) }
      case (.locked(let holder), nil):
        state = configuration.attachOnly ? .waitingForHost : .holderExited(holder)
      case (.locked(let holder), let next?) where canAttach(next) || next.pid != holder.pid:
        if canAttach(next) { attach(next) } else { state = .locked(next) }
      case (.holderExited, let next?), (.waitingForHost, let next?):
        if canAttach(next) { attach(next) } else { lock(next) }
      default:
        break
      }
    }

    private func stopFollowing() {
      watch?.cancel()
      watch = nil
    }

    /// Ask the app holding the home to quit, then start ours. Never for an
    /// attach-only app: it has no host of its own to start.
    public func takeOver() {
      guard !configuration.attachOnly else { return }
      let holder: HostLockRecord
      switch state {
      case .locked(let record), .attached(let record): holder = record
      default: return
      }
      stopFollowing()
      state = .handingOver(holder)
      HostLock.askToQuit(holder)
      Task {
        let released = await HostLock.waitForRelease(
          home: configuration.home, timeout: .seconds(30))
        onEvent?(.handover(holder: holder.owner, success: released))
        if released {
          launch()
        } else {
          lock(HostLock.read(home: configuration.home) ?? holder)
        }
      }
    }

    /// SIGTERM, then wait for the host's own shutdown; SIGKILL past `timeout`.
    public func stop(timeout: Duration = .seconds(15)) async {
      stopping = true
      stopFollowing()
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
      guard !stopping, !configuration.attachOnly else { return }
      stopFollowing()
      state = restarts == 0 ? .starting : .restarting(attempt: restarts)
      let log = LogSink(file: configuration.logFile, maxBytes: Self.maxLogBytes)
      self.log = log

      let process = Process()
      process.executableURL = configuration.node
      process.arguments = configuration.arguments(ownerPid: getpid())
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
        if canAttach(holder) { attach(holder) } else { lock(holder) }
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
