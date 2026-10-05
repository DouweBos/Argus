import ArgusUI

extension AppPreferences {
  /// Fixed-size text (`Font.scaled`, transcript and diff fonts) grows with the body.
  func applyDisplaySize() { TextScale.shared.factor = textScale }
}
