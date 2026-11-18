import ArgusCore
import ArgusKit
import ArgusUI
import SwiftUI

/// The Browser tab's Select Element mode: hovering highlights what's under
/// the pointer, a click picks it for the chat. Points are 0–1 across the page.
@MainActor
@Observable
final class BrowserElementPicker {
  private(set) var active = false
  private(set) var hit: ArgusProtocol.BrowserElementHit?
  private(set) var picking = false

  /// One hover lookup at a time; the newest point waits for the reply.
  @ObservationIgnored private var inFlight = false
  @ObservationIgnored private var queued: CGPoint??

  func toggle() {
    active ? cancel() : (active = true)
  }

  func cancel() {
    active = false
    hit = nil
    queued = nil
  }

  func hover(_ point: CGPoint?, backend: (any HostBackend)?, sessionId: String) {
    guard active else { return }
    guard let point else {
      hit = nil
      queued = .some(nil)
      return
    }
    guard !inFlight else {
      queued = .some(point)
      return
    }
    inFlight = true
    Task {
      let next = try? await backend?.request(
        ArgusProtocol.Commands.BrowserElementAt.self, .init(sessionId: sessionId, x: point.x, y: point.y))
      inFlight = false
      if active { hit = next ?? nil }
      if let waiting = queued {
        queued = nil
        hover(waiting, backend: backend, sessionId: sessionId)
      }
    }
  }

  /// Picks the element at `point` and leaves the mode; nil when nothing came back.
  func pick(at point: CGPoint, backend: (any HostBackend)?, sessionId: String) async -> PickedElement? {
    picking = true
    defer {
      picking = false
      cancel()
    }
    let element = try? await backend?.request(
      ArgusProtocol.Commands.BrowserPickElement.self, .init(sessionId: sessionId, x: point.x, y: point.y))
    return (element ?? nil).map(PickedElement.browser)
  }
}

/// The hovered element's outline and name over the screencast.
struct BrowserPickHighlight: View {
  let hit: ArgusProtocol.BrowserElementHit
  /// Where the page's picture sits in the stage.
  let picture: CGRect

  private var rect: CGRect {
    let sx = picture.width / max(hit.viewport.width, 1)
    let sy = picture.height / max(hit.viewport.height, 1)
    return CGRect(
      x: picture.minX + hit.bounds.x * sx, y: picture.minY + hit.bounds.y * sy,
      width: hit.bounds.width * sx, height: hit.bounds.height * sy)
  }

  var body: some View {
    ElementPickHighlight(
      rect: rect,
      label: "\(hit.label)  \(Int(hit.bounds.width.rounded()))×\(Int(hit.bounds.height.rounded()))",
      bounds: picture)
  }
}
