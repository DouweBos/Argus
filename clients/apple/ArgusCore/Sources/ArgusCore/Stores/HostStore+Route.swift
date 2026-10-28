import ArgusKit
import Foundation

extension HostStore {
  /// Something tied to this exact connection is running: a device stream or a
  /// terminal reader. Switching routes would cut it off, so a route upgrade waits.
  public var hasConnectionBoundWork: Bool {
    !mediaSinks.isEmpty || !terminalObservers.isEmpty
  }

  /// Move to a better route without dropping the computer's data: the new
  /// backend is adopted first, then everything a fresh connection loses is
  /// re-read, and only then is the old one closed. It stays open a moment so
  /// requests already in flight on it can still answer.
  public func swapBackend(_ next: any HostBackend, drain: Duration = .seconds(10)) async {
    let previous = backend
    await attach(next)
    resyncTranscripts()
    resyncQueues()
    guard let previous else { return }
    Task {
      try? await Task.sleep(for: drain)
      await previous.disconnect()
    }
  }
}
