import ArgusCore
import Foundation

/// App state that belongs to one Argus home (picks keyed by session, tabs
/// naming its machines, its onboarding step), kept in a plist inside that
/// home. `UserDefaults` is shared by every build with the same bundle id, so
/// state there leaks between dev, test and throwaway homes.
@MainActor
final class HomeDefaults {
  static let shared = HomeDefaults(file: HostLocation.current.home.appendingPathComponent("mac-app-state.plist"))
  /// Posted after any write, so the host's copy can follow (`HostPreferences`).
  static let didChange = Notification.Name("HomeDefaults.didChange")

  /// Keys that used to live in `UserDefaults`; dropped there so a stale value
  /// from another home can't come back.
  static let legacyKeys = [
    "runtime.platform", "runtime.iosBySession", "runtime.androidBySession", "runtime.browserPreset",
    "window.tabs", "window.activeTab", "home.hiddenProjects", "onboardingStep",
  ]

  private let file: URL
  private var values: [String: Any]

  init(file: URL) {
    self.file = file
    values = (try? Data(contentsOf: file))
      .flatMap { try? PropertyListSerialization.propertyList(from: $0, format: nil) as? [String: Any] } ?? [:]
  }

  func string(forKey key: String) -> String? { values[key] as? String }
  func stringArray(forKey key: String) -> [String]? { values[key] as? [String] }
  func dictionary(forKey key: String) -> [String: Any]? { values[key] as? [String: Any] }
  func data(forKey key: String) -> Data? { values[key] as? Data }
  func array(forKey key: String) -> [Any]? { values[key] as? [Any] }

  func set(_ value: Any?, forKey key: String) {
    values[key] = value
    save()
    NotificationCenter.default.post(name: Self.didChange, object: self)
  }

  func removeObject(forKey key: String) {
    guard values.removeValue(forKey: key) != nil else { return }
    save()
    NotificationCenter.default.post(name: Self.didChange, object: self)
  }

  static func dropLegacyKeys(from defaults: UserDefaults = .standard) {
    legacyKeys.forEach(defaults.removeObject(forKey:))
  }

  private func save() {
    guard let data = try? PropertyListSerialization.data(fromPropertyList: values, format: .binary, options: 0)
    else { return }
    try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? data.write(to: file, options: .atomic)
  }
}
