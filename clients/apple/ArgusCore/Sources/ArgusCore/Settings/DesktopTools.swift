import ArgusKit
import Foundation

/// The togglable tools of `app/tools/registry.ts`, and what each needs on the
/// machine. The host persists the toggles (`get_enabled_tools`).
public struct DesktopTool: Identifiable, Sendable {
  public let id: String
  public let name: String
  public let description: String
  public let defaultEnabled: Bool
  public let prereqs: [ArgusProtocol.PrereqId]
  /// Tools this one is useless without.
  public let requires: [String]

  public static let all: [DesktopTool] = [
    DesktopTool(
      id: "device-recording", name: "Device recording",
      description: "Stream iOS Simulator and Android emulator screens into Argus's runtime panel.",
      defaultEnabled: true, prereqs: [.xcode, .iosRuntimes, .androidSdk, .androidAvd], requires: []),
    DesktopTool(
      id: "device-inspector", name: "Device UI inspector",
      description: "Inspect view hierarchy, accessibility, and layout on a connected device.",
      defaultEnabled: true, prereqs: [], requires: ["device-recording"]),
    DesktopTool(
      id: "device-control", name: "Device control (conductor)",
      description: "Drive devices with the conductor CLI: deep links, taps, keyboard, navigation.",
      defaultEnabled: true, prereqs: [.androidSdk, .playwright], requires: []),
    DesktopTool(
      id: "device-debug", name: "Device debug streams",
      description: "Tail device logs, memory, and other conductor probes from the Debug panel.",
      defaultEnabled: true, prereqs: [], requires: ["device-control"]),
  ]

  /// The toggle as the user left it, else the tool's default.
  public static func userEnabled(_ id: String, in toggles: [String: Bool]) -> Bool {
    toggles[id] ?? all.first { $0.id == id }?.defaultEnabled ?? false
  }

  /// On, and every tool it requires is effectively on too.
  public static func effectivelyEnabled(_ id: String, in toggles: [String: Bool]) -> Bool {
    guard userEnabled(id, in: toggles), let tool = all.first(where: { $0.id == id }) else {
      return false
    }
    return tool.requires.allSatisfy { effectivelyEnabled($0, in: toggles) }
  }

  /// The requirements keeping an enabled tool off, by name.
  public static func missingRequirements(_ id: String, in toggles: [String: Bool]) -> [String] {
    guard let tool = all.first(where: { $0.id == id }) else { return [] }
    return tool.requires.filter { !effectivelyEnabled($0, in: toggles) }.map { dep in
      all.first { $0.id == dep }?.name ?? dep
    }
  }
}

/// How a prereq is named and installed by hand (`PrereqList/meta.ts`).
public struct PrereqMeta: Sendable {
  public let title: String
  public let installCommand: String?
  public let installLabel: String?
  public let installURL: String?

  public static func of(_ id: ArgusProtocol.PrereqId) -> PrereqMeta {
    switch id {
    case .claudeCli:
      PrereqMeta(
        title: "Claude Code CLI", installCommand: "npm install -g @anthropic-ai/claude-code",
        installLabel: "Install guide",
        installURL: "https://docs.claude.com/en/docs/claude-code/quickstart")
    case .claudeAuth:
      PrereqMeta(
        title: "Claude authentication", installCommand: "claude login", installLabel: "Sign-in help",
        installURL: "https://docs.claude.com/en/docs/claude-code/quickstart")
    case .gitCli:
      PrereqMeta(
        title: "Git on PATH", installCommand: "xcode-select --install", installLabel: "git-scm.com",
        installURL: "https://git-scm.com/downloads/mac")
    case .gitIdentity:
      PrereqMeta(title: "Git identity", installCommand: nil, installLabel: nil, installURL: nil)
    case .xcode:
      PrereqMeta(
        title: "Xcode", installCommand: nil, installLabel: "App Store",
        installURL: "https://apps.apple.com/app/xcode/id497799835")
    case .iosRuntimes:
      PrereqMeta(
        title: "iOS simulator runtimes", installCommand: "xcodebuild -downloadPlatform iOS",
        installLabel: "Apple docs",
        installURL:
          "https://developer.apple.com/documentation/xcode/installing-additional-simulator-runtimes")
    case .androidSdk:
      PrereqMeta(
        title: "Android SDK", installCommand: "brew install --cask android-platform-tools",
        installLabel: "Android Studio", installURL: "https://developer.android.com/studio")
    case .androidAvd:
      PrereqMeta(
        title: "Android AVDs", installCommand: nil, installLabel: "AVD Manager guide",
        installURL: "https://developer.android.com/studio/run/managing-avds")
    case .playwright:
      PrereqMeta(
        title: "Playwright browsers", installCommand: "npx playwright install",
        installLabel: "Playwright docs", installURL: "https://playwright.dev/docs/browsers")
    default:
      PrereqMeta(title: id.rawValue, installCommand: nil, installLabel: nil, installURL: nil)
    }
  }
}
