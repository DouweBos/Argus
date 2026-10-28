import ArgusCore

extension HostLocation {
  /// The Mac app's: `~/.argus`, or `~/.argus-mac-dev` in a debug build.
  static let current: HostLocation = {
    #if DEBUG
      .desktop(isDebug: true)
    #else
      .desktop(isDebug: false)
    #endif
  }()
}
