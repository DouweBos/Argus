import ArgusKit
import Foundation

/// `.argus.json` as the Project Settings screen edits it: every field the
/// desktop dialog has, in the shapes a form binds to (numbers stay text until
/// saved, as the dialog's inputs do).
///
/// It is read from the raw file rather than the host's normalized config, and
/// written back over that raw file, so keys this app doesn't know survive.
public struct ArgusConfigDraft: Equatable, Sendable {
  // Setup
  public var copy: [ListItem] = []
  public var symlink: [ListItem] = []
  public var commands: [ListItem] = []
  public var minArgusVersion = ""
  /// `{ path, exclude }` entries: the form edits the path, the excludes ride along.
  var copyExcludes: [String: JSONValue] = [:]
  var symlinkExcludes: [String: JSONValue] = [:]

  // Runtime
  public var workspaceEnv: [EnvVar] = []
  public var run: [RunCommand] = []
  public var singleRuntime = false
  public var terminals: [Terminal] = []
  public var browserUrl = ""
  public var browserPresets: [BrowserPreset] = []
  public var deeplinks: [Deeplink] = []

  // Workflow
  public var protectedBranches: [ListItem] = []
  public var defaultBaseBranch = ""
  public var pullRequestTemplate = ""
  public var autoFetchMinutes = 0
  public var releaseNotes: [ReleasePattern] = []
  public var agentPrompt = ""
  public var saveChatHistory = true
  public var autoContinueOnLimit = false
  public var llmRunner = ""
  public var llmModel = ""
  public var relatedProjects: [RelatedProject] = []
  public var mcpServers: [McpServer] = []
  public var disabledTools: [String] = []
  public var autonomyCeiling: String?
  public var automationPathDenylist = ""
  public var disabledAutomations = ""

  public init() {}

  // MARK: Rows

  public struct ListItem: Identifiable, Equatable, Sendable {
    public let id: UUID
    public var value: String
    public init(_ value: String = "") {
      id = UUID()
      self.value = value
    }
  }

  public struct Terminal: Identifiable, Equatable, Sendable {
    public let id = UUID()
    public var name = ""
    public var dir = ""
    public init(name: String = "", dir: String = "") {
      self.name = name
      self.dir = dir
    }
  }

  public struct RunCommand: Identifiable, Equatable, Sendable {
    public let id = UUID()
    public var title = ""
    public var command = ""
    public var cwd = ""
    public var restartOnRerun = false
    public var requires: [String] = []
    public init(
      title: String = "", command: String = "", cwd: String = "", restartOnRerun: Bool = false,
      requires: [String] = []
    ) {
      self.title = title
      self.command = command
      self.cwd = cwd
      self.restartOnRerun = restartOnRerun
      self.requires = requires
    }
  }

  public struct EnvVar: Identifiable, Equatable, Sendable {
    public enum Strategy: String, CaseIterable, Sendable { case hash, sequential }
    public let id = UUID()
    public var name = ""
    public var baseValue = ""
    public var range = ""
    public var strategy = Strategy.hash
    public init(name: String = "", baseValue: String = "", range: String = "", strategy: Strategy = .hash) {
      self.name = name
      self.baseValue = baseValue
      self.range = range
      self.strategy = strategy
    }
  }

  public struct BrowserPreset: Identifiable, Equatable, Sendable {
    public let id = UUID()
    public var key = ""
    public var label = ""
    public var width = ""
    public var height = ""
    public var userAgent = ""
    public init(key: String = "", label: String = "", width: String = "", height: String = "", userAgent: String = "") {
      self.key = key
      self.label = label
      self.width = width
      self.height = height
      self.userAgent = userAgent
    }
  }

  /// A leaf link, or a folder when `children` is set.
  public struct Deeplink: Identifiable, Equatable, Sendable {
    public let id = UUID()
    public var label = ""
    public var url = ""
    public var children: [Deeplink]?
    public init(label: String = "", url: String = "", children: [Deeplink]? = nil) {
      self.label = label
      self.url = url
      self.children = children
    }
    public var isFolder: Bool { children != nil }
  }

  public struct RelatedProject: Identifiable, Equatable, Sendable {
    public let id = UUID()
    public var path = ""
    public var description = ""
    public init(path: String = "", description: String = "") {
      self.path = path
      self.description = description
    }
  }

  public struct McpServer: Identifiable, Equatable, Sendable {
    public let id = UUID()
    public var name = ""
    public var json = "{\n  \"command\": \"\"\n}"
    public init(name: String = "", json: String = "{\n  \"command\": \"\"\n}") {
      self.name = name
      self.json = json
    }

    /// Why this entry can't be saved, as the desktop words it.
    public var error: String? {
      if name.trimmingCharacters(in: .whitespaces).isEmpty { return "Name is required." }
      guard let parsed = try? ConfigJSON.parse(json) else { return "Invalid JSON." }
      guard case .object = parsed else { return "Config must be a JSON object." }
      return nil
    }
  }

  public struct ReleasePattern: Identifiable, Equatable, Sendable {
    public static let formats = ["changesets", "regex", "json", "yaml", "xml"]
    public let id = UUID()
    public var glob = ""
    public var format = "changesets"
    public var labels: [Label] = []
    public init(glob: String = "", format: String = "changesets", labels: [Label] = []) {
      self.glob = glob
      self.format = format
      self.labels = labels
    }

    public struct Label: Identifiable, Equatable, Sendable {
      public static let tones = ["", "accent", "neutral", "success", "warning"]
      public let id = UUID()
      public var name = ""
      public var selector = ""
      public var tone = ""
      public init(name: String = "", selector: String = "", tone: String = "") {
        self.name = name
        self.selector = selector
        self.tone = tone
      }
    }
  }

  // MARK: Constants

  public static let autonomyLevels = ["propose", "draft", "pr", "auto_merge"]
  /// The Git settings panel's choices; any other saved value is kept as is.
  public static let autoFetchOptions = [0, 5, 15, 60]
  /// The tools a project can mask off, in the desktop's order.
  public static let tools: [(id: String, name: String, description: String)] = [
    (
      "device-recording", "Device recording",
      "Stream iOS Simulator and Android emulator screens into Argus's runtime panel."
    ),
    (
      "device-inspector", "Device UI inspector",
      "Inspect view hierarchy, accessibility, and layout on a connected device."
    ),
    (
      "device-control", "Device control (conductor)",
      "Drive devices with the conductor CLI: deep links, taps, keyboard, navigation."
    ),
    (
      "device-debug", "Device debug streams",
      "Tail device logs, memory, and other conductor probes from the Debug panel."
    ),
  ]

  // MARK: Validation

  /// What blocks a save. The desktop only refuses invalid MCP entries; an
  /// auto-fetch interval can't go negative from a picker, so there's nothing else.
  public var validationErrors: [String] {
    mcpServers.compactMap { server in
      server.error.map { "MCP server \(server.name.isEmpty ? "(unnamed)" : server.name): \($0)" }
    }
  }

  public var isValid: Bool { validationErrors.isEmpty }

  /// Other run commands this one may depend on, by title.
  public func requirableTitles(for command: RunCommand) -> [String] {
    run.filter { $0.id != command.id }.map { $0.title.trimmingCharacters(in: .whitespaces) }
      .filter { !$0.isEmpty }
  }
}
