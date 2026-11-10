import AppIntents
import ArgusCore
import Foundation

/// The app's one `AppStore`, outside any view: Siri and Shortcuts launch the
/// app in the background, where no `RootView` exists to own it.
@MainActor
enum AppRuntime {
  static let app = AppStore()
}

/// Why an intent couldn't do what it was asked, in words Siri can say.
enum IntentFailure: Error, CustomLocalizedStringResourceConvertible {
  case notPaired
  case unknownComputer
  case unreachable(String)
  case noControl(String)
  case notFound(String)
  case failed(String)

  var localizedStringResource: LocalizedStringResource {
    switch self {
    case .notPaired: "Pair a computer in Argus first."
    case .unknownComputer: "That computer isn't paired with this phone anymore."
    case .unreachable(let name): "Couldn't reach \(name)."
    case .noControl(let name): "This phone can only watch \(name), not control it."
    case .notFound(let what): "Couldn't find \(what)."
    case .failed(let what): "\(what)"
    }
  }
}

/// Gets the store onto the computer an intent names, reusing the live
/// connection when it is already the right one.
@MainActor
enum IntentHost {
  /// `hostId` nil is the computer the app was last on.
  @discardableResult
  static func connect(_ hostId: String?, control: Bool = false) async throws -> AppStore {
    let app = AppRuntime.app
    await app.initialize()
    guard !app.hosts.isEmpty else { throw IntentFailure.notPaired }
    let target = hostId ?? app.activeHostId ?? app.hosts.first?.deviceId
    guard let target, let identity = app.hosts.first(where: { $0.deviceId == target }) else {
      throw IntentFailure.unknownComputer
    }
    if target != app.activeHostId || app.host.connection == .offline { await app.selectHost(target) }
    guard await waitUntilReady(app) else { throw IntentFailure.unreachable(identity.label) }
    if control, !app.host.hasControl { throw IntentFailure.noControl(identity.label) }
    return app
  }

  /// The label of a paired computer, for dialogs and entity subtitles.
  static func label(_ hostId: String) -> String {
    AppRuntime.app.hosts.first { $0.deviceId == hostId }?.label ?? "your computer"
  }

  private static func waitUntilReady(_ app: AppStore) async -> Bool {
    let deadline = Date.now.addingTimeInterval(20)
    while Date.now < deadline {
      switch app.host.connection {
      case .ready: return true
      // A first race that failed outright; a later re-race may still land.
      case .offline where app.host.backend == nil && app.host.lastError != nil: return false
      default: try? await Task.sleep(for: .milliseconds(200))
      }
    }
    return app.host.connection == .ready
  }
}

/// Entity ids that name a computer as well as the thing on it, since this
/// phone may be paired with several and holds one connection at a time.
enum ScopedId {
  private static let separator: Character = "\n"

  static func make(_ hostId: String, _ id: String) -> String { "\(hostId)\(separator)\(id)" }

  static func split(_ raw: String) -> (hostId: String, id: String)? {
    let parts = raw.split(separator: separator, maxSplits: 1).map(String.init)
    return parts.count == 2 ? (parts[0], parts[1]) : nil
  }
}
