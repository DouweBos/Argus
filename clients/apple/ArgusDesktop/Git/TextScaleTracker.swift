import ArgusUI
import CoreGraphics

/// Tells an AppKit table its rows' fonts changed size; reading the scale in
/// `updateNSView` is what makes SwiftUI call it again on a Display size change.
@MainActor
struct TextScaleTracker {
  private var applied = TextScale.shared.factor

  /// True once per change.
  mutating func changed() -> Bool {
    let now = TextScale.shared.factor
    defer { applied = now }
    return now != applied
  }
}
