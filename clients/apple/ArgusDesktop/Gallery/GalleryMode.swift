import Foundation

/// `ARGUS_GALLERY=render|browse`: the app comes up as the component gallery
/// (`pnpm gallery`) — no host, no main window, no menu-bar item. Debug only.
enum GalleryMode {
  enum Kind: String {
    case render, browse
  }

  static let kind: Kind? = {
    #if DEBUG
      ProcessInfo.processInfo.environment["ARGUS_GALLERY"].flatMap(Kind.init(rawValue:))
    #else
      nil
    #endif
  }()

  static var active: Bool { kind != nil }
}
