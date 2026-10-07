import Foundation

/// "Your name on a huddle invite", shared with the Electron app through the
/// host (`HostPreferences`). Empty falls back to the session's git `user.name`.
enum HuddleDisplayName {
  static let key = "huddleDisplayName"

  static var value: String { UserDefaults.standard.string(forKey: key) ?? "" }
}
