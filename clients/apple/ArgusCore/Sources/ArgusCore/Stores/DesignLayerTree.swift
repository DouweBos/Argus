import ArgusKit
import CoreGraphics

/// A frame's flattened layers, read back as the tree they were flattened from.
public struct DesignLayerTree: Sendable {
  public typealias Layer = ArgusProtocol.FigmaLayer

  public let layers: [Layer]
  /// Each layer's parent's index; nil for the root.
  private let parents: [Int?]
  private let indexById: [String: Int]

  public init(_ layers: [Layer]) {
    self.layers = layers
    var parents: [Int?] = []
    var stack: [Int] = []
    for (index, layer) in layers.enumerated() {
      while let last = stack.last, layers[last].depth >= layer.depth { stack.removeLast() }
      parents.append(stack.last)
      stack.append(index)
    }
    self.parents = parents
    indexById = Dictionary(layers.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { first, _ in first })
  }

  public func layer(_ id: String?) -> Layer? {
    id.flatMap { indexById[$0] }.map { layers[$0] }
  }

  public func hasChildren(_ id: String) -> Bool {
    guard let index = indexById[id], index + 1 < layers.count else { return false }
    return parents[index + 1] == index
  }

  /// Every layer above `id`, nearest first.
  public func ancestors(of id: String) -> [String] {
    var found: [String] = []
    var cursor = indexById[id].flatMap { parents[$0] }
    while let index = cursor {
      found.append(layers[index].id)
      cursor = parents[index]
    }
    return found
  }

  /// The rows left showing once `collapsed` layers hide their descendants.
  public func visible(collapsed: Set<String>) -> [Layer] {
    var rows: [Layer] = []
    var hiddenBelow: Double?
    for layer in layers {
      if let depth = hiddenBelow {
        if layer.depth > depth { continue }
        hiddenBelow = nil
      }
      rows.append(layer)
      if collapsed.contains(layer.id) { hiddenBelow = layer.depth }
    }
    return rows
  }

  /// Where a layer sits in frame points, when the host sent its position.
  public static func rect(_ layer: Layer) -> CGRect? {
    guard let x = layer.x, let y = layer.y, let width = layer.width, let height = layer.height else { return nil }
    return CGRect(x: x, y: y, width: width, height: height)
  }

  /// The deepest, topmost layer under `point`, as Figma's ⌘-click picks it.
  /// Later rows draw over earlier ones, so the last hit wins.
  public func hit(_ point: CGPoint) -> Layer? {
    layers.last { Self.rect($0)?.contains(point) ?? false }
  }
}
