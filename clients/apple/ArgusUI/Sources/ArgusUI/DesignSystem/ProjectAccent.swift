import SwiftUI

/// A stable colour per project, from a hash of its path. Same palette and hash
/// as the desktop app, so a project wears the same colour in both.
public enum ProjectAccent {
  static let palette: [UInt32] = [
    0x4D9FFF, 0x7C5CFC, 0x00D4AA, 0xF5A623, 0xFF4466,
    0xFF7A59, 0x22C55E, 0xE879F9, 0x06B6D4, 0xFACC15,
  ]

  public static func color(for path: String) -> Color {
    Color(hex: palette[index(for: path)])
  }

  static func index(for path: String) -> Int {
    guard !path.isEmpty else { return 0 }
    return Int(fnv1a(path) % UInt32(palette.count))
  }

  /// FNV-1a over UTF-16 code units, matching JavaScript's `charCodeAt`.
  static func fnv1a(_ input: String) -> UInt32 {
    var hash: UInt32 = 0x811C_9DC5
    for unit in input.utf16 {
      hash ^= UInt32(unit)
      hash = hash &+ (hash << 1) &+ (hash << 4) &+ (hash << 7) &+ (hash << 8) &+ (hash << 24)
    }
    return hash
  }
}
