import ArgusKit
import Foundation

/// Polls, foreground resumes and reconnect reloads run as background refreshes.
/// One that fails only because the connection was down is retried on the next
/// connection rather than reported: the connection state is already on screen.
public enum BackgroundRefresh {
  @TaskLocal public static var isActive = false

  /// Run `body` as a background refresh; tasks it starts inherit that.
  public static func run(
    isolation: isolated (any Actor)? = #isolation, _ body: () async -> Void
  ) async {
    await $isActive.withValue(true, operation: body)
  }
}

extension HostStore {
  private nonisolated static let transientURLCodes: Set<URLError.Code> = [
    .timedOut, .networkConnectionLost, .notConnectedToInternet, .cannotConnectToHost,
    .cannotFindHost, .dnsLookupFailed,
  ]

  /// The connection failed rather than the request.
  public nonisolated static func isTransient(_ error: Error) -> Bool {
    if let transport = error as? Transport.TransportError { return transport.isTransient }
    if let url = error as? URLError { return transientURLCodes.contains(url.code) }
    return false
  }

  /// Nothing to tell anyone: cancelled, or a background refresh that lost its connection.
  public nonisolated static func isQuiet(_ error: Error) -> Bool {
    isCancellation(error) || (BackgroundRefresh.isActive && isTransient(error))
  }
}
