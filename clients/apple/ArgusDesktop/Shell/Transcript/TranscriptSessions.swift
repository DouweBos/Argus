import AppKit
import ArgusUI

/// One agent's transcript kept across view lifetimes: the table with its
/// measured rows and scroll position, find and open/closed state, and the
/// link handler. Coming back to a chat reattaches the same table, so it shows
/// exactly where it was instead of rebuilding and remeasuring.
@MainActor
final class TranscriptSession {
  let model: TranscriptModel
  let controller: TranscriptTableController
  let links: TranscriptLinkHandler

  init(store: HostStore, sessionId: String) {
    model = TranscriptModel()
    controller = TranscriptTableController(model: model)
    links = TranscriptLinkHandler(store: store, sessionId: sessionId)
  }

  /// On screen somewhere: a table can only be in one window at a time.
  var isAttached: Bool { controller.scrollView.superview != nil }
}

/// The last few agents' transcripts, by agent key. A view claims its agent's
/// session; when that session is on screen in another window, it gets one of
/// its own for as long as it lives.
@MainActor
final class TranscriptSessions {
  static let shared = TranscriptSessions()
  /// Enough for hopping between the agents of a session or two.
  static let capacity = 6

  private var sessions: [String: TranscriptSession] = [:]
  private var owners: [String: ObjectIdentifier] = [:]
  private var recent: [String] = []

  func session(for agentKey: String, owner: Owner, store: HostStore, sessionId: String) -> TranscriptSession {
    // Each host window has its own store, and agent keys only mean something within one.
    let key = "\(ObjectIdentifier(store))|\(agentKey)"
    if let own = owner.private[key] { return own }
    let id = ObjectIdentifier(owner)
    if let session = sessions[key] {
      if owners[key] == id || !session.isAttached {
        owners[key] = id
        touch(key)
        return session
      }
      let own = TranscriptSession(store: store, sessionId: sessionId)
      owner.private[key] = own
      return own
    }
    let session = TranscriptSession(store: store, sessionId: sessionId)
    sessions[key] = session
    owners[key] = id
    touch(key)
    evict()
    return session
  }

  #if DEBUG
    /// A gallery story starts from no kept transcripts, so its setup's session is the one the pane claims.
    func forgetAll() {
      sessions = [:]
      owners = [:]
      recent = []
    }
  #endif

  private func touch(_ key: String) {
    recent.removeAll { $0 == key }
    recent.append(key)
  }

  private func evict() {
    while recent.count > Self.capacity,
      let oldest = recent.first(where: { sessions[$0]?.isAttached == false })
    {
      recent.removeAll { $0 == oldest }
      sessions[oldest] = nil
      owners[oldest] = nil
    }
  }

  /// A view's identity for claiming, and the sessions it had to make for itself.
  @MainActor
  final class Owner {
    fileprivate var `private`: [String: TranscriptSession] = [:]
  }
}
