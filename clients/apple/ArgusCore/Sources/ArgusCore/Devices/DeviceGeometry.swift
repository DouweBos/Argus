import CoreGraphics

/// Where a device's picture sits in a view and how a point there maps back
/// onto the device — shared by every surface that mirrors one.
///
/// The framebuffer is panel-native, so a rotated device arrives sideways and
/// is turned `rotation` degrees clockwise to sit upright.
public struct DeviceGeometry: Equatable, Sendable {
  /// The stream's coded size, before rotation.
  public var coded: CGSize
  /// The view it is drawn in.
  public var stage: CGSize
  /// 0, 90, 180 or 270.
  public var rotation: Double

  public init(coded: CGSize, stage: CGSize, rotation: Double = 0) {
    self.coded = coded
    self.stage = stage
    self.rotation = rotation
  }

  var quarterTurn: Bool { rotation == 90 || rotation == 270 }
  var known: Bool { coded.width > 0 && coded.height > 0 && stage.width > 0 && stage.height > 0 }

  /// The stream's footprint on screen, with its axes swapped on a quarter turn.
  public var shown: CGSize {
    quarterTurn ? CGSize(width: coded.height, height: coded.width) : coded
  }

  private var scale: CGFloat {
    min(stage.width / shown.width, stage.height / shown.height)
  }

  /// The video's frame size before rotation, so a landscape device fills the
  /// width instead of being letterboxed into a portrait box. The stage until
  /// the first config lands.
  public var renderedSize: CGSize {
    guard known else { return stage }
    return CGSize(width: coded.width * scale, height: coded.height * scale)
  }

  /// The upright picture's rect in the stage.
  public var pictureRect: CGRect {
    guard known else { return CGRect(origin: .zero, size: stage) }
    let size = CGSize(width: shown.width * scale, height: shown.height * scale)
    return CGRect(
      x: (stage.width - size.width) / 2, y: (stage.height - size.height) / 2,
      width: size.width, height: size.height)
  }

  /// A stage point (top-left origin) to 0–1 device panel coordinates, clamped
  /// to the picture. Nil until the stream's size is known.
  public func normalize(_ point: CGPoint) -> CGPoint? {
    guard known else { return nil }
    let rect = pictureRect
    let x = min(max(0, (point.x - rect.minX) / rect.width), 0.9999)
    let y = min(max(0, (point.y - rect.minY) / rect.height), 0.9999)
    return unrotate(CGPoint(x: x, y: y))
  }

  /// Undo the presentation rotation: the device wants the point in its own
  /// panel's coordinates, not in the ones we drew.
  public func unrotate(_ point: CGPoint) -> CGPoint {
    switch rotation {
    case 90: CGPoint(x: point.y, y: 1 - point.x)
    case 180: CGPoint(x: 1 - point.x, y: 1 - point.y)
    case 270: CGPoint(x: 1 - point.y, y: point.x)
    default: point
    }
  }
}
