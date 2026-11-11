import Foundation

/// Keeps an updater's channel on the host's `updater_channel`. A failed read
/// keeps the last channel and goes to `log`; the caller syncs again on reconnect,
/// on a settings change and before a manual check.
@MainActor
public final class UpdateChannelSync {
  /// Reads `updater_channel`; throws when the host can't answer.
  public typealias Load = @MainActor () async throws -> String?

  private let load: Load
  private let apply: @MainActor (UpdateChannel) -> Void
  private let log: @MainActor (any Error) -> Void

  public init(
    load: @escaping Load,
    apply: @escaping @MainActor (UpdateChannel) -> Void,
    log: @escaping @MainActor (any Error) -> Void
  ) {
    self.load = load
    self.apply = apply
    self.log = log
  }

  @discardableResult
  public func sync() async -> Bool {
    do {
      apply(UpdateChannel(setting: try await load()))
      return true
    } catch {
      log(error)
      return false
    }
  }

  /// Whether a `prefs:changed` naming these settings keys moves the channel.
  public static func affects(settings keys: [String]) -> Bool {
    keys.contains("updater_channel")
  }

  /// Thrown by a `load` with no host to ask yet.
  public struct NotConnected: Error, CustomStringConvertible {
    public init() {}
    public var description: String { "host not connected" }
  }
}
