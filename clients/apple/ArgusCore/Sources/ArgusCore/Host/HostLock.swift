#if os(macOS)
  import Darwin
  import Foundation

  /// `$ARGUS_HOME/host.lock`, as `packages/host/src/lib/hostLock.ts` writes it.
  public struct HostLockRecord: Codable, Sendable, Equatable {
    public enum Owner: String, Codable, Sendable {
      case electron, mac, cli
      case macServer = "mac-server"
    }

    /// The process running the host core.
    public var pid: Int32
    /// The app to ask to quit — killing a supervised host just restarts it.
    public var ownerPid: Int32
    public var owner: Owner
    public var startedAt: Double
    /// The host's local UI socket, once it is listening; a window may attach.
    public var socket: String?
    /// The `LOCAL_UI_PROTOCOL` that socket speaks.
    public var `protocol`: Int?

    enum CodingKeys: String, CodingKey {
      case pid, owner, socket, `protocol`
      case ownerPid = "owner_pid"
      case startedAt = "started_at"
    }

    public init(
      pid: Int32, ownerPid: Int32, owner: Owner, startedAt: Double,
      socket: String? = nil, protocol: Int? = nil
    ) {
      self.pid = pid
      self.ownerPid = ownerPid
      self.owner = owner
      self.startedAt = startedAt
      self.socket = socket
      self.protocol = `protocol`
    }

    public init(from decoder: Decoder) throws {
      let c = try decoder.container(keyedBy: CodingKeys.self)
      pid = try c.decode(Int32.self, forKey: .pid)
      ownerPid = try c.decodeIfPresent(Int32.self, forKey: .ownerPid) ?? pid
      owner = (try? c.decode(Owner.self, forKey: .owner)) ?? .cli
      startedAt = try c.decodeIfPresent(Double.self, forKey: .startedAt) ?? 0
      socket = try? c.decodeIfPresent(String.self, forKey: .socket)
      `protocol` = try? c.decodeIfPresent(Int.self, forKey: .protocol)
    }

    /// Its host serves a UI socket this app can attach to as a second window.
    public var attachable: Bool {
      socket != nil && `protocol` == HostLock.uiProtocol
    }

    /// The app holding it, as a name: "Attached to Argus (Electron)".
    public var appName: String {
      switch owner {
      case .electron: "Argus (Electron)"
      case .mac: "Argus for Mac"
      case .macServer: "Argus Server"
      case .cli: "argus-host"
      }
    }

    /// Who holds it, in words.
    public var holderName: String {
      switch owner {
      case .electron: "Argus (Electron)"
      case .mac: "Argus for Mac"
      case .macServer: "Argus Server"
      case .cli: "An Argus host"
      }
    }
  }

  public enum HostLock {
    /// `LOCAL_UI_PROTOCOL` in `packages/remote-protocol/src/messages.ts`.
    public static let uiProtocol = 1

    public static func path(home: URL) -> URL {
      home.appendingPathComponent("host.lock")
    }

    static func isAlive(_ pid: Int32) -> Bool {
      guard pid > 0 else { return false }
      return kill(pid, 0) == 0 || errno == EPERM
    }

    /// The live holder, or nil when the lock is free or stale.
    public static func read(home: URL) -> HostLockRecord? {
      guard let data = try? Data(contentsOf: path(home: home)),
        let record = try? JSONDecoder().decode(HostLockRecord.self, from: data),
        isAlive(record.pid)
      else { return nil }
      return record
    }

    /// Ask the holder's app to quit. Electron runs its own quit flow on SIGTERM.
    public static func askToQuit(_ record: HostLockRecord) {
      kill(record.ownerPid, SIGTERM)
    }

    /// Wait until nobody holds the lock; false on timeout.
    public static func waitForRelease(home: URL, timeout: Duration) async -> Bool {
      let deadline = ContinuousClock.now + timeout
      while read(home: home) != nil {
        if ContinuousClock.now >= deadline { return false }
        try? await Task.sleep(for: .milliseconds(200))
      }
      return true
    }
  }
#endif
