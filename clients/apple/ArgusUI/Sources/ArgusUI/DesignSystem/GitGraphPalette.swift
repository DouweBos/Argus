import SwiftUI

/// The commit graph's lane colours, a twin of Peacock's `LANE_COLORS`
/// (`GitGraphCell.tsx`). The same eight in both schemes, as on the web.
public enum GitGraphPalette {
  public static let hex: [UInt32] = [
    0xE06C75, 0xE5C07B, 0x98C379, 0x61AFEF, 0xC678DD, 0x56B6C2, 0xD19A66, 0xBE5046,
  ]

  public static let lanes: [Color] = hex.map { Color(hex: $0) }

  /// A lane's colour; indices wrap around the palette.
  public static func lane(_ index: Int) -> Color {
    lanes[((index % lanes.count) + lanes.count) % lanes.count]
  }
}
