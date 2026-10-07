import ArgusKit
import Foundation

/// Raw `ipc` broadcasts — the host's own event channels (`browser_view:nav`,
/// `terminal:data:<id>`, …) — for views that need more than the typed events.
/// Only a local backend receives them.
extension HostStore {
  /// Called with every channel, its arguments and the envelope's `seq` until
  /// the returned closure runs.
  public func observeIpc(
    _ handler: @escaping @MainActor (_ channel: String, _ args: [JSONValue], _ seq: Int) -> Void
  ) -> () -> Void {
    let id = UUID()
    ipcObservers[id] = handler
    return { [weak self] in
      Task { @MainActor in self?.ipcObservers.removeValue(forKey: id) }
    }
  }

  func notifyIpcObservers(_ envelope: EventEnvelope) {
    guard !ipcObservers.isEmpty,
      let ipc = try? ProtocolCodec.convert(envelope.payload, to: IpcPayload.self)
    else { return }
    for handler in ipcObservers.values { handler(ipc.channel, ipc.args ?? [], envelope.seq) }
  }
}

/// The raw broadcast a console connection receives as an `ipc` event.
struct IpcPayload: Decodable {
  let channel: String
  let args: [JSONValue]?
}
