import AppKit
import ApplicationServices
import ArgusCore
import CoreGraphics
import Observation

/// Windows of the apps running on this Mac, and whether macOS lets Argus watch
/// and drive them. Listed and shown in this process only: no host command or
/// gateway method reaches them, so a paired phone or another computer never sees one.
@MainActor
@Observable
final class MacApps {
  private(set) var windows: [MacAppWindow] = []
  private(set) var permissions: MacAppPermissions
  @ObservationIgnored private var observers: [NSObjectProtocol] = []

  init() {
    permissions = Self.currentPermissions()
    // System Settings is where both grants are given, so coming back is when to look again.
    observers.append(
      NotificationCenter.default.addObserver(
        forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated { self?.recheckPermissions() }
      })
    let workspace = NSWorkspace.shared.notificationCenter
    for name in [NSWorkspace.didLaunchApplicationNotification, NSWorkspace.didTerminateApplicationNotification] {
      observers.append(
        workspace.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
          MainActor.assumeIsolated { self?.refresh() }
        })
    }
  }

  #if DEBUG
    /// Gallery fixtures, without asking macOS.
    init(windows: [MacAppWindow], permissions: MacAppPermissions) {
      self.windows = windows
      self.permissions = permissions
    }
  #endif

  /// On-screen windows only: a minimised one or one on another Space draws nothing to mirror.
  func refresh() {
    guard
      let infos = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
        as? [[String: Any]]
    else { return }
    let next = MacAppWindowList.windows(from: infos, ownPid: getpid()) {
      NSRunningApplication(processIdentifier: $0)?.bundleIdentifier
    }
    if next != windows { windows = next }
    recheckPermissions()
  }

  func recheckPermissions() {
    let now = Self.currentPermissions()
    if now != permissions { permissions = now }
  }

  private static func currentPermissions() -> MacAppPermissions {
    MacAppPermissions(screenRecording: CGPreflightScreenCaptureAccess(), accessibility: AXIsProcessTrusted())
  }

  /// macOS's own prompt the first time; once it's been answered it only opens System Settings.
  func request(_ grant: MacAppPermissions.Grant) {
    switch grant {
    case .screenRecording:
      if !CGRequestScreenCaptureAccess() { openSettings(grant) }
    case .accessibility:
      let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
      if !AXIsProcessTrustedWithOptions(options) { openSettings(grant) }
    }
    recheckPermissions()
  }

  func openSettings(_ grant: MacAppPermissions.Grant) {
    NSWorkspace.shared.open(grant.settingsURL)
  }

  func window(_ key: String?) -> MacAppWindow? {
    key.flatMap(MacAppTarget.init(key:))?.resolve(in: windows)
  }

  /// The app's icon, from the running process or else where the app is installed.
  static func icon(_ window: MacAppWindow) -> NSImage? {
    if let running = NSRunningApplication(processIdentifier: window.pid), running.bundleIdentifier == window.bundleId {
      return running.icon
    }
    return NSWorkspace.shared.urlForApplication(withBundleIdentifier: window.bundleId).map {
      NSWorkspace.shared.icon(forFile: $0.path)
    }
  }

  /// Where a window is now, in global points; nil once it closed.
  nonisolated static func frame(of windowId: UInt32) -> CGRect? {
    guard
      let info = (CGWindowListCopyWindowInfo(.optionIncludingWindow, CGWindowID(windowId)) as? [[String: Any]])?
        .first,
      let bounds = info[kCGWindowBounds as String] as? NSDictionary
    else { return nil }
    return CGRect(dictionaryRepresentation: bounds)
  }
}
