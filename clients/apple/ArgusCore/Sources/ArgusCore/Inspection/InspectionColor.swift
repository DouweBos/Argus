import Foundation

extension Inspection {
  /// A captured `#RRGGBB[AA]` color, components in 0…1 — what the overlay tints
  /// with and what the color editor round-trips to `inspection_set_property`.
  public struct RGBA: Hashable, Sendable {
    public var red: Double
    public var green: Double
    public var blue: Double
    public var alpha: Double

    public init(red: Double, green: Double, blue: Double, alpha: Double = 1) {
      self.red = red
      self.green = green
      self.blue = blue
      self.alpha = alpha
    }

    /// `RRGGBB` or `RRGGBBAA`, `#` optional; alpha defaults to opaque.
    public init?(hex: String) {
      var s = hex.trimmingCharacters(in: .whitespaces)
      if s.hasPrefix("#") { s.removeFirst() }
      guard s.count == 6 || s.count == 8, let value = UInt64(s, radix: 16) else { return nil }
      let full = s.count == 6 ? (value << 8) | 0xFF : value
      red = Double((full >> 24) & 0xFF) / 255
      green = Double((full >> 16) & 0xFF) / 255
      blue = Double((full >> 8) & 0xFF) / 255
      alpha = Double(full & 0xFF) / 255
    }

    /// `#RRGGBBAA`, the bridge's format.
    public var hex: String {
      func byte(_ v: Double) -> String {
        String(format: "%02X", Int((min(max(v, 0), 1) * 255).rounded()))
      }
      return "#\(byte(red))\(byte(green))\(byte(blue))\(byte(alpha))"
    }
  }
}
