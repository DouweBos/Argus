import Foundation
import Observation

/// The code view's chrome that outlives a session and a relaunch: whether the navigator shows.
/// Its width is the `code.navigator` split's. Opening a file never touches either.
@MainActor
@Observable
final class CodeLayout {
  static let shared = CodeLayout()
  static let navigatorKey = "argus:code.navigatorVisible"

  @ObservationIgnored private let defaults: UserDefaults

  var navigatorVisible: Bool {
    didSet { defaults.set(navigatorVisible, forKey: Self.navigatorKey) }
  }

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    navigatorVisible = defaults.object(forKey: Self.navigatorKey) as? Bool ?? true
  }
}
