import AppKit
import ArgusCore
import ArgusKit
import ArgusUI
import SwiftUI

/// Select Element over a live device: entering takes one inspection capture
/// and hit-tests against it, so a pick is instant and matches what was read.
/// The next entry captures afresh. Points are 0–1 across the upright picture.
@MainActor
@Observable
final class DeviceElementPicker {
  enum Phase: Equatable {
    case idle
    case capturing
    case active
  }

  private(set) var phase = Phase.idle
  private(set) var capture: Inspection.Capture?
  private(set) var hovered: Inspection.Node?

  @ObservationIgnored private var task: Task<Void, Never>?

  var engaged: Bool { phase != .idle }

  func toggle(backend: (any HostBackend)?, deviceId: String, platform: RemotePlatform) {
    guard phase == .idle else { return cancel() }
    phase = .capturing
    task = Task {
      let raw = try? await backend?.request(
        ArgusProtocol.Commands.DeviceElementCapture.self,
        .init(deviceKey: deviceId, platform: platform == .android ? .android : .ios))
      guard !Task.isCancelled, phase == .capturing else { return }
      guard let raw, let capture = Self.usable(Inspection.normalize(raw)) else {
        cancel()
        NSSound.beep()
        MacTelemetry.capture(.elementPicked(source: .devicePreview, success: false))
        return
      }
      self.capture = capture
      phase = .active
    }
  }

  func cancel() {
    task?.cancel()
    task = nil
    phase = .idle
    capture = nil
    hovered = nil
  }

  func hover(_ unit: CGPoint?) {
    guard phase == .active else { return }
    let next = unit.flatMap(node)
    if next?.id != hovered?.id { hovered = next }
  }

  /// The element at `unit`, ready for the chat; leaves the mode either way.
  func pick(at unit: CGPoint) -> PickedElement? {
    defer { cancel() }
    guard phase == .active, let capture, let node = node(at: unit) else { return nil }
    return PickedElement.device(node, path: capture.hierarchy.path(to: node.id), capture: capture)
  }

  /// A node's rect as 0–1 of the screen it was captured on.
  func unitRect(_ node: Inspection.Node) -> CGRect {
    let screen = capture?.screenSize ?? CGSize(width: 1, height: 1)
    let r = node.rect
    return CGRect(
      x: r.x / screen.width, y: r.y / screen.height, width: r.w / screen.width, height: r.h / screen.height)
  }

  private func node(at unit: CGPoint) -> Inspection.Node? {
    guard let capture else { return nil }
    let screen = capture.screenSize
    return capture.hierarchy.pickTarget(x: unit.x * screen.width, y: unit.y * screen.height)
  }

  /// A garbled or empty capture normalizes to a frameless root; nothing to pick from.
  private static func usable(_ capture: Inspection.Capture) -> Inspection.Capture? {
    capture.hierarchy.flattened().contains { $0.rect.w > 0 && $0.rect.h > 0 } ? capture : nil
  }

  #if DEBUG
    /// The gallery's picker, already reading `capture` with `hovered` under the pointer.
    static func preview(capture: Inspection.Capture?, hovered: String?) -> DeviceElementPicker {
      let picker = DeviceElementPicker()
      picker.capture = capture
      picker.phase = capture == nil ? .capturing : .active
      picker.hovered = hovered.flatMap { capture?.hierarchy.find($0) }
      return picker
    }
  #endif
}

/// What the picker draws over the device: the hovered element, or a note while it reads the screen.
struct DevicePickOverlay: View {
  @Environment(\.theme) private var theme
  let picker: DeviceElementPicker
  let geometry: DeviceGeometry

  var body: some View {
    switch picker.phase {
    case .idle:
      EmptyView()
    case .capturing:
      HStack(spacing: 6) {
        ProgressView().controlSize(.mini)
        Text("Reading the screen")
          .font(.scaled(size: 11, weight: .medium))
          .foregroundStyle(theme.text)
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 4)
      .background(theme.bgSecondary, in: .capsule)
      .overlay { Capsule().strokeBorder(theme.border, lineWidth: 1) }
      .padding(10)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      .allowsHitTesting(false)
    case .active:
      if let node = picker.hovered {
        ElementPickHighlight(
          rect: geometry.uprightRect(picker.unitRect(node)), label: node.pickLabel,
          bounds: geometry.pictureRect)
      }
    }
  }
}
