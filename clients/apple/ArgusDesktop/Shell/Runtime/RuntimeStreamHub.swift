import ArgusCore
import Foundation

/// Shares one host stream between every view showing the same device or
/// browser. The host hands a connection a single stream per subject, so the
/// panel and a popout of the same simulator would otherwise steal each other's
/// frames, and the first to close would stop the other's picture.
@MainActor
final class RuntimeStreamHub {
  enum Subject: Hashable {
    case device(String, RemotePlatform)
    case browser(String)
  }

  private final class Entry {
    var sinks: [UUID: (MediaMessage) -> Void] = [:]
    /// Replayed to a late joiner: the decoder needs the parameter sets and
    /// everything since the last keyframe, a JPEG only the last frame.
    var config: MediaMessage?
    var sinceKeyFrame: [MediaMessage] = []
    var unregister: (() -> Void)?
    var opening: Task<UInt16?, Never>?
  }

  /// A device sending only deltas would grow this forever.
  private static let replayCap = 300

  private let store: HostStore
  private var entries: [Subject: Entry] = [:]

  init(store: HostStore) {
    self.store = store
  }

  /// Start receiving `subject`'s frames; nil when the host couldn't start the
  /// stream. Call the returned closure to stop.
  func attach(_ subject: Subject, _ sink: @escaping (MediaMessage) -> Void) async -> (() -> Void)? {
    let entry = entries[subject] ?? Entry()
    entries[subject] = entry
    let id = UUID()
    entry.sinks[id] = sink
    if let config = entry.config { sink(config) }
    for message in entry.sinceKeyFrame { sink(message) }

    if entry.unregister == nil {
      let opening = entry.opening ?? Task { await self.open(subject) }
      entry.opening = opening
      guard let streamId = await opening.value else {
        entry.opening = nil
        entry.sinks.removeValue(forKey: id)
        if entry.sinks.isEmpty { entries.removeValue(forKey: subject) }
        return nil
      }
      if entry.unregister == nil {
        entry.unregister = store.registerMediaSink(streamId: streamId) { [weak entry] message in
          entry.map { Self.deliver(message, to: $0) }
        }
      }
    }
    return { [weak self] in self?.detach(subject, id) }
  }

  private func open(_ subject: Subject) async -> UInt16? {
    switch subject {
    case .device(let id, let platform):
      return await store.watchDevice(deviceId: id, platform: platform)
    case .browser(let sessionId):
      return await store.watchBrowser(sessionId: sessionId)
    }
  }

  private static func deliver(_ message: MediaMessage, to entry: Entry) {
    switch message {
    case .config:
      entry.config = message
      entry.sinceKeyFrame = []
    case .frame(_, let keyFrame, _, _):
      if keyFrame { entry.sinceKeyFrame = [] }
      if entry.sinceKeyFrame.count < replayCap { entry.sinceKeyFrame.append(message) }
    case .jpeg:
      entry.sinceKeyFrame = [message]
    }
    for sink in entry.sinks.values { sink(message) }
  }

  private func detach(_ subject: Subject, _ id: UUID) {
    guard let entry = entries[subject] else { return }
    entry.sinks.removeValue(forKey: id)
    guard entry.sinks.isEmpty else { return }
    entries.removeValue(forKey: subject)
    entry.unregister?()
    let store = store
    Task {
      // Let go before leaving, so another client isn't locked out by a
      // picture nobody is looking at.
      switch subject {
      case .device(let id, _):
        await store.releaseDevice(deviceId: id)
        await store.unwatchDevice(deviceId: id)
      case .browser(let sessionId):
        await store.unwatchBrowser(sessionId: sessionId)
      }
    }
  }
}
