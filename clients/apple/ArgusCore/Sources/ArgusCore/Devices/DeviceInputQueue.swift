import Foundation

/// Sends device input one request at a time, in the order it happened. A task
/// per event let a tap's up overtake its down, which the device read as a
/// finger held down: every click became a long press.
@MainActor
final class DeviceInputQueue {
  struct Item {
    /// Set on a drag sample: one still waiting is replaced by the next, so a
    /// slow link lags by a single sample instead of a growing backlog.
    var coalesceKey: String?
    var send: @MainActor () async -> Void
  }

  private var pending: [Item] = []
  private var draining = false

  func enqueue(_ item: Item) {
    if let key = item.coalesceKey, let last = pending.last, last.coalesceKey == key {
      pending[pending.count - 1] = item
    } else {
      pending.append(item)
    }
    guard !draining else { return }
    draining = true
    Task { await drain() }
  }

  private func drain() async {
    while !pending.isEmpty {
      let item = pending.removeFirst()
      await item.send()
    }
    draining = false
  }
}
