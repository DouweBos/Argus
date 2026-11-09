#if DEBUG
  import AppKit
  import ObjectiveC

  /// `ARGUS_SHOTS_ACTIVE`: every window draws as the key window of the active
  /// app — coloured traffic lights, accent selection — while the app stays in
  /// the background. Marketing captures (`pnpm shots`) need the active look and
  /// must never take focus from whoever is using the machine.
  enum ShotsActiveAppearance {
    static func installIfConfigured() {
      guard ProcessInfo.processInfo.environment["ARGUS_SHOTS_ACTIVE"] != nil else { return }
      install()
    }

    static func install() {
      // The public getters, and the private ones the titlebar and controls draw from.
      let window = [
        "isKeyWindow", "isMainWindow", "hasKeyAppearance", "hasMainAppearance", "_isKeyWindow",
        "_isKeyWindowIgnoringFocus", "_hasKeyAppearance", "_hasMainAppearance", "_hasActiveAppearance",
        "_hasActiveAppearanceIgnoringKeyFocus", "_hasActiveControls",
      ]
      window.forEach { alwaysTrue(NSWindow.self, NSSelectorFromString($0)) }
      ["isActive", "_isActiveApp"].forEach { alwaysTrue(NSApplication.self, NSSelectorFromString($0)) }
    }

    /// `backstage` (`window`, a window number): on every Space, behind every
    /// other window. A window capture reads the window's own buffer, so it
    /// still works covered — and the capture never shows up in front of the
    /// user, nor fails because they switched Space.
    static func run(_ command: [String: Any]) -> [String: Any]? {
      guard command["op"] as? String == "backstage" else { return nil }
      guard let number = command["window"] as? Int,
        let window = NSApp.windows.first(where: { $0.windowNumber == number })
      else { return ["error": "window?"] }
      window.collectionBehavior.insert(.canJoinAllSpaces)
      window.orderBack(nil)
      return ["ok": true, "onActiveSpace": window.isOnActiveSpace]
    }

    private static func alwaysTrue(_ cls: AnyClass, _ selector: Selector) {
      guard let method = class_getInstanceMethod(cls, selector) else { return }
      let block: @convention(block) (AnyObject) -> Bool = { _ in true }
      method_setImplementation(method, imp_implementationWithBlock(block))
    }
  }
#endif
