import CoreGraphics
import Foundation

/// A window of an app on this Mac that the runtime panel can mirror.
public struct MacAppWindow: Identifiable, Equatable, Sendable {
  /// The `CGWindowID`: what ScreenCaptureKit and posted events name it by.
  public let windowId: UInt32
  public let pid: Int32
  public let bundleId: String
  public let appName: String
  /// Empty until Screen Recording is allowed: macOS hides other apps' window titles before then.
  public let title: String
  /// In global screen points, top-left origin, as CoreGraphics events use them.
  public let frame: CGRect

  public var id: UInt32 { windowId }
  public var target: MacAppTarget { MacAppTarget(bundleId: bundleId, windowId: windowId) }

  public init(windowId: UInt32, pid: Int32, bundleId: String, appName: String, title: String, frame: CGRect) {
    self.windowId = windowId
    self.pid = pid
    self.bundleId = bundleId
    self.appName = appName
    self.title = title
    self.frame = frame
  }
}

/// A picked window, kept by app as well so it survives the app reopening it under a new id.
public struct MacAppTarget: Equatable, Hashable, Sendable {
  public let bundleId: String
  public let windowId: UInt32

  public init(bundleId: String, windowId: UInt32) {
    self.bundleId = bundleId
    self.windowId = windowId
  }

  /// How the pick is stored per session.
  public var key: String { "\(bundleId)#\(windowId)" }

  public init?(key: String) {
    guard let hash = key.lastIndex(of: "#"), let id = UInt32(key[key.index(after: hash)...]) else { return nil }
    let bundle = String(key[..<hash])
    guard !bundle.isEmpty else { return nil }
    self.init(bundleId: bundle, windowId: id)
  }

  /// The same window, else another window of the same app; nil once the app has none.
  public func resolve(in windows: [MacAppWindow]) -> MacAppWindow? {
    windows.first { $0.windowId == windowId } ?? windows.first { $0.bundleId == bundleId }
  }
}

/// Turns `CGWindowListCopyWindowInfo` into the windows worth offering.
public enum MacAppWindowList {
  /// Argus's own builds and the host never mirror themselves.
  public static let ownBundlePrefix = "dev.houwert.argus"
  /// Below this a window is a palette, tooltip or status item, not something to watch.
  static let minimumSize = CGSize(width: 80, height: 60)

  /// `infos` as CoreGraphics returns them; `bundleId` names a pid's app, nil for a bare process.
  public static func windows(
    from infos: [[String: Any]], ownPid: Int32, bundleId: (Int32) -> String?
  ) -> [MacAppWindow] {
    let windows = infos.compactMap { info -> MacAppWindow? in
      guard
        let number = (info["kCGWindowNumber"] as? NSNumber)?.uint32Value,
        let pid = (info["kCGWindowOwnerPID"] as? NSNumber)?.int32Value, pid != ownPid,
        (info["kCGWindowLayer"] as? NSNumber)?.intValue == 0,
        (info["kCGWindowAlpha"] as? NSNumber)?.doubleValue ?? 1 > 0,
        let bounds = info["kCGWindowBounds"] as? [String: Any],
        let frame = rect(bounds),
        frame.width >= minimumSize.width, frame.height >= minimumSize.height,
        let bundle = bundleId(pid), !bundle.hasPrefix(ownBundlePrefix)
      else { return nil }
      return MacAppWindow(
        windowId: number, pid: pid, bundleId: bundle,
        appName: info["kCGWindowOwnerName"] as? String ?? bundle,
        title: info["kCGWindowName"] as? String ?? "", frame: frame)
    }
    return windows.sorted {
      let byApp = $0.appName.localizedStandardCompare($1.appName)
      if byApp != .orderedSame { return byApp == .orderedAscending }
      return $0.title.localizedStandardCompare($1.title) == .orderedAscending
    }
  }

  private static func rect(_ bounds: [String: Any]) -> CGRect? {
    func value(_ key: String) -> CGFloat? { (bounds[key] as? NSNumber).map { CGFloat($0.doubleValue) } }
    guard let x = value("X"), let y = value("Y"), let width = value("Width"), let height = value("Height") else {
      return nil
    }
    return CGRect(x: x, y: y, width: width, height: height)
  }
}

/// The two privacy grants a mirror needs, as macOS reports them for Argus.
public struct MacAppPermissions: Equatable, Sendable {
  /// `CGPreflightScreenCaptureAccess`: needed to show the window at all.
  public var screenRecording: Bool
  /// `AXIsProcessTrusted`: needed to click and type into it.
  public var accessibility: Bool

  public init(screenRecording: Bool, accessibility: Bool) {
    self.screenRecording = screenRecording
    self.accessibility = accessibility
  }

  public enum Grant: String, Sendable, CaseIterable {
    case screenRecording = "screen_recording"
    case accessibility

    /// The Privacy & Security pane that lists Argus for this grant.
    public var settingsURL: URL {
      switch self {
      case .screenRecording:
        URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")!
      case .accessibility:
        URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!
      }
    }
  }

  /// What stops the mirror from showing: only Screen Recording does.
  public var blocking: Grant? { screenRecording ? nil : .screenRecording }
  /// The mirror shows but only watches: input needs Accessibility.
  public var viewOnly: Bool { screenRecording && !accessibility }
  /// The first grant still missing, for telemetry; nil when both are in.
  public var missing: Grant? { blocking ?? (accessibility ? nil : .accessibility) }
}

/// Maps a point on the mirror back onto the real window.
public enum MacAppMirrorGeometry {
  /// `point` in the stage's top-left coordinates to global screen points, nil
  /// outside the letterboxed picture.
  public static func screenPoint(_ point: CGPoint, stage: CGSize, window: CGRect) -> CGPoint? {
    let geometry = DeviceGeometry(coded: window.size, stage: stage)
    guard let unit = geometry.uprightNormalize(point) else { return nil }
    return CGPoint(x: window.minX + unit.x * window.width, y: window.minY + unit.y * window.height)
  }
}
