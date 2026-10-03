import Foundation

/// "Your name on a huddle invite" — machine-local, as the desktop keeps it in
/// localStorage. Empty falls back to the session's git `user.name`.
enum HuddleDisplayName {
  static let key = "huddleDisplayName"

  static var value: String { UserDefaults.standard.string(forKey: key) ?? "" }
}
