import AppKit
import ArgusUI
import SwiftUI

/// Installed apps' own icons for "Open in" rows, so a dropdown reads like the Dock.
@MainActor
enum AppIcons {
  /// Bundle ids for the host's editor ids, in order of preference.
  private static let bundleIds: [String: [String]] = [
    "vscode": ["com.microsoft.VSCode", "com.microsoft.VSCodeInsiders"],
    "cursor": ["com.todesktop.230313mzl4w4u92"],
    "zed": ["dev.zed.Zed", "dev.zed.Zed-Preview"],
    "codex": ["com.openai.codex"],
    "intellij": ["com.jetbrains.intellij", "com.jetbrains.intellij.ce"],
    "xcode": ["com.apple.dt.Xcode"],
    "androidstudio": ["com.google.android.studio"],
    "finder": ["com.apple.finder"],
  ]

  private static var cache: [String: NSImage?] = [:]

  /// The editor's app icon, else `fallback` as a symbol when it isn't installed as an app.
  static func icon(editorId: String, fallback: String = Icon.openExternal) -> ChromeIcon {
    image(editorId).map { .image(Image(nsImage: $0)) } ?? .symbol(fallback)
  }

  static var finder: ChromeIcon { icon(editorId: "finder", fallback: Icon.folder) }

  private static func image(_ id: String) -> NSImage? {
    if let cached = cache[id] { return cached }
    let url = bundleIds[id]?.lazy.compactMap { NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0) }.first
    let image = url.map { NSWorkspace.shared.icon(forFile: $0.path) }
    cache[id] = image
    return image
  }
}
