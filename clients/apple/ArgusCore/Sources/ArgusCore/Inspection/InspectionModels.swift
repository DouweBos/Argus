import Foundation

/// The device UI inspector's data contract — a mirror of the renderer's
/// `app/features/inspection/types.ts`. The host returns `inspection_capture` as
/// untyped JSON; `Inspection.normalize(_:)` turns it into these.
public enum Inspection {}

extension Inspection {
  public struct Frame: Hashable, Sendable {
    public var x: Double
    public var y: Double
    public var w: Double
    public var h: Double

    public init(x: Double, y: Double, w: Double, h: Double) {
      self.x = x
      self.y = y
      self.w = w
      self.h = h
    }

    public static let zero = Frame(x: 0, y: 0, w: 0, h: 0)

    public func contains(x px: Double, y py: Double) -> Bool {
      w > 0 && h > 0 && px >= x && px <= x + w && py >= y && py <= y + h
    }
  }

  public struct Font: Hashable, Sendable {
    public var name: String
    public var family: String
    public var size: Double
    public var bold: Bool
    public var italic: Bool
    public var weight: Double?
  }

  /// React Native tag mapping so a node reads as its JSX component.
  public struct ReactNative: Hashable, Sendable {
    public var reactTag: String?
    public var nativeID: String?
    public var testID: String?
  }

  public struct Image: Hashable, Sendable {
    public var w: Double
    public var h: Double
    public var scale: Double
    public var name: String?
  }

  /// One UIView/CALayer node. Optional keys are only emitted when they carry
  /// signal, so `nil` means "default", not "unknown".
  public struct Node: Hashable, Sendable, Identifiable {
    /// Stable within a launch; pointer-based, so it resets on relaunch.
    public var id: String
    /// Native class, e.g. `UIButton`, `RCTParagraphComponentView`.
    public var className: String
    /// Superview-local.
    public var frame: Frame
    /// Window-absolute; what the overlay draws.
    public var absFrame: Frame?
    public var depth: Int
    public var z: Double?
    public var alpha: Double?
    public var hidden: Bool
    public var accessibilityIdentifier: String?
    public var accessibilityLabel: String?
    /// Colors are `#RRGGBBAA`.
    public var backgroundColor: String?
    public var textColor: String?
    public var tintColor: String?
    public var titleColor: String?
    public var text: String?
    public var title: String?
    public var placeholder: String?
    public var font: Font?
    public var image: Image?
    public var enabled: Bool?
    public var cornerRadius: Double?
    public var maskedCorners: Double?
    public var masksToBounds: Bool
    public var borderWidth: Double?
    public var borderColor: String?
    public var shadowOpacity: Double?
    public var shadowRadius: Double?
    public var shadowColor: String?
    public var gradientColors: [String]?
    public var transform3D: [Double]?
    public var anchorPoint: Point?
    public var hasMask: Bool
    public var rn: ReactNative?
    /// Subviews dropped at the bridge's depth/node cap.
    public var truncated: Int?
    public var children: [Node]

    public init(
      id: String, className: String, frame: Frame, absFrame: Frame? = nil, depth: Int,
      children: [Node] = []
    ) {
      self.id = id
      self.className = className
      self.frame = frame
      self.absFrame = absFrame
      self.depth = depth
      self.hidden = false
      self.masksToBounds = false
      self.hasMask = false
      self.children = children
    }

    /// The on-screen rect; window roots' local frame already is absolute.
    public var rect: Frame { absFrame ?? frame }
  }

  public struct Point: Hashable, Sendable {
    public var x: Double
    public var y: Double
  }

  public struct Device: Hashable, Sendable {
    public var deviceId: String
    public var platform: String
    public var width: Double
    public var height: Double

    public init(deviceId: String, platform: String, width: Double, height: Double) {
      self.deviceId = deviceId
      self.platform = platform
      self.width = width
      self.height = height
    }
  }

  public struct Capture: Hashable, Sendable {
    public var capturedAt: String
    public var device: Device
    public var hierarchy: Node
    public var nodeCount: Int
    /// Decoded PNG bytes; the overlay draws bare boxes without it.
    public var screenshot: Data?
  }
}
