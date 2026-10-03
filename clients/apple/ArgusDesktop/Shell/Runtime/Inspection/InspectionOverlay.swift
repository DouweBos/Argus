import AppKit
import ArgusUI
import SwiftUI

/// The captured screen with a box per node: hover to preview, click to
/// select, double-click to focus, right-click for everything under the
/// pointer — the renderer's `FlatRenderer`.
struct InspectionOverlay: View {
  @Environment(\.theme) private var theme
  let model: InspectionModel
  let snapshot: InspectionModel.Snapshot
  let root: Inspection.Node

  /// Nodes under the pointer, outermost first; only replaced when it changes
  /// so plain pointer motion doesn't redraw.
  @State private var hoverStack: [Inspection.Node] = []

  private var deviceSize: CGSize {
    let device = snapshot.capture.device
    if device.width > 0, device.height > 0 { return CGSize(width: device.width, height: device.height) }
    let rect = snapshot.capture.hierarchy.rect
    return CGSize(width: max(rect.w, 1), height: max(rect.h, 1))
  }

  var body: some View {
    GeometryReader { proxy in
      let scale = min(
        proxy.size.width / deviceSize.width, proxy.size.height / deviceSize.height)
      let stage = CGSize(width: deviceSize.width * scale, height: deviceSize.height * scale)
      ZStack {
        if let image = snapshot.image {
          Image(nsImage: image).resizable().interpolation(.high)
        }
        NodeBoxes(
          nodes: root.flattened(), scale: scale, tint: snapshot.image == nil,
          selectedId: model.selectedId, hoveredId: hoverStack.last?.id)
      }
      .frame(width: stage.width, height: stage.height)
      // AppKit takes the clicks: SwiftUI's tap gestures drop the first click
      // into a window that isn't key.
      .overlay {
        RuntimeInputView(tracksHover: true, toolTip: hoverStack.last.map(tooltip)) { input in
          receive(input, scale)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .padding(12)
    .background(theme.mediaBg)
  }

  private func receive(_ input: RuntimeInput, _ scale: CGFloat) {
    switch input {
    case .hover(let point):
      updateHover(point.map { hits($0, scale) } ?? [])
    case .pointer(.down, let point, let secondary, let clickCount):
      let stack = hits(point, scale)
      if secondary {
        showStackMenu(stack)
      } else if let node = stack.last {
        if clickCount == 2 { model.focus(node.id) } else { model.select(node.id) }
      }
    default:
      break
    }
  }

  /// Every element under the pointer, innermost last, to pick one that a
  /// click can't reach.
  private func showStackMenu(_ stack: [Inspection.Node]) {
    guard !stack.isEmpty, let event = NSApp.currentEvent, let view = event.window?.contentView
    else { return }
    let menu = NSMenu()
    menu.addItem(withTitle: "\(stack.count) elements under cursor", action: nil, keyEquivalent: "")
      .isEnabled = false
    for node in stack.reversed() {
      let item = ClosureMenuItem(title: menuLabel(node)) { [model] in model.select(node.id) }
      item.state = model.selectedId == node.id ? .on : .off
      menu.addItem(item)
    }
    NSMenu.popUpContextMenu(menu, with: event, for: view)
  }

  private func hits(_ point: CGPoint, _ scale: CGFloat) -> [Inspection.Node] {
    guard scale > 0 else { return [] }
    return root.nodes(containingX: point.x / scale, y: point.y / scale)
  }

  private func updateHover(_ stack: [Inspection.Node]) {
    if stack.map(\.id) != hoverStack.map(\.id) { hoverStack = stack }
  }

  private func menuLabel(_ node: Inspection.Node) -> String {
    let rect = node.rect
    let size = "\(Inspection.format(rect.w))×\(Inspection.format(rect.h))"
    return [node.className, node.hint(), size].compactMap { $0 }.joined(separator: "  ")
  }

  private func tooltip(_ node: Inspection.Node) -> String {
    node.hint(maxLength: .max).map { "\(node.className)  \($0)" } ?? node.className
  }
}

/// A menu item that runs a closure; `NSMenu` only knows target/action.
private final class ClosureMenuItem: NSMenuItem {
  private let run: () -> Void

  init(title: String, run: @escaping () -> Void) {
    self.run = run
    super.init(title: title, action: #selector(fire), keyEquivalent: "")
    target = self
  }

  required init(coder: NSCoder) { fatalError("init(coder:) is unused") }

  @objc private func fire() { run() }
}

/// The boxes alone, in one `Canvas`: thousands of nodes stay cheap.
private struct NodeBoxes: View {
  @Environment(\.theme) private var theme
  let nodes: [Inspection.Node]
  let scale: CGFloat
  /// Fill with each node's real background when there's no screenshot behind.
  let tint: Bool
  let selectedId: String?
  let hoveredId: String?

  var body: some View {
    Canvas { context, _ in
      var selected: CGRect?
      var hovered: CGRect?
      for node in nodes {
        let rect = frame(node)
        guard rect.width > 0, rect.height > 0 else { continue }
        if tint, let color = node.backgroundColor.flatMap(Inspection.RGBA.init(hex:)) {
          context.fill(Path(rect), with: .color(Color(rgba: color)))
        }
        let line = node.isLeaf ? theme.accent.opacity(0.45) : theme.border
        context.stroke(Path(rect), with: .color(line), lineWidth: node.isLeaf ? 1 : 0.5)
        if node.id == selectedId { selected = rect }
        if node.id == hoveredId { hovered = rect }
      }
      // Highlights go last so siblings drawn later can't cover them.
      if let hovered, hovered != selected {
        context.fill(Path(hovered), with: .color(theme.accent.opacity(0.12)))
        context.stroke(Path(hovered), with: .color(theme.accent), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
      }
      if let selected {
        context.fill(Path(selected), with: .color(theme.accent.opacity(0.22)))
        context.stroke(Path(selected), with: .color(theme.accent), lineWidth: 2)
      }
    }
    .allowsHitTesting(false)
  }

  private func frame(_ node: Inspection.Node) -> CGRect {
    let r = node.rect
    return CGRect(x: r.x * scale, y: r.y * scale, width: r.w * scale, height: r.h * scale)
  }
}

extension Color {
  /// A captured device color — runtime data, not a theme token.
  init(rgba: Inspection.RGBA) {
    self.init(.sRGB, red: rgba.red, green: rgba.green, blue: rgba.blue, opacity: rgba.alpha)
  }
}
