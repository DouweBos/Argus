import ArgusKit
import Foundation

/// Reading a raw `.argus.json` into the draft and writing the draft back over
/// it, with the same trimming and defaults the desktop dialog applies.
extension ArgusConfigDraft {
  /// Every key the draft owns. Anything else in the file is left untouched.
  static let ownedKeys: Set<String> = [
    "setup", "terminals", "run", "workspace_env", "platforms", "agent_prompt", "related_projects",
    "browser_url", "browser_presets", "simulator_deeplinks", "save_chat_history",
    "auto_continue_on_limit", "protected_branches", "pull_request_template", "default_base_branch",
    "single_runtime", "min_argus_version", "mcp_servers", "auto_fetch_minutes",
    "release_note_patterns", "llm", "tools", "automations",
  ]

  public init(raw: [String: JSONValue]) {
    self.init()
    let setup = raw["setup"]?.objectValue ?? [:]
    (copy, copyExcludes) = Self.setupEntries(setup["copy"])
    (symlink, symlinkExcludes) = Self.setupEntries(setup["symlink"])
    commands = Self.strings(setup["commands"]).map { ListItem($0) }
    minArgusVersion = raw["min_argus_version"]?.stringValue ?? ""

    platforms = Self.strings(raw["platforms"]).filter(Self.platformOptions.contains)
    workspaceEnv = Self.objects(raw["workspace_env"]).map {
      EnvVar(
        name: $0["name"]?.stringValue ?? "",
        baseValue: Self.text($0["base_value"]),
        range: Self.text($0["range"]),
        strategy: EnvVar.Strategy(rawValue: $0["strategy"]?.stringValue ?? "") ?? .hash)
    }
    run = Self.objects(raw["run"]).map {
      RunCommand(
        title: $0["title"]?.stringValue ?? "",
        command: $0["command"]?.stringValue ?? "",
        cwd: $0["cwd"]?.stringValue ?? "",
        restartOnRerun: $0["restartOnRerun"]?.boolValue ?? false,
        requires: Self.strings($0["requires"]))
    }
    singleRuntime = raw["single_runtime"]?.boolValue ?? false
    terminals = Self.objects(raw["terminals"]).map {
      Terminal(name: $0["name"]?.stringValue ?? "", dir: $0["dir"]?.stringValue ?? "")
    }
    browserUrl = raw["browser_url"]?.stringValue ?? ""
    browserPresets = Self.objects(raw["browser_presets"]).map {
      BrowserPreset(
        key: $0["id"]?.stringValue ?? "",
        label: $0["label"]?.stringValue ?? "",
        width: Self.text($0["width"]),
        height: Self.text($0["height"]),
        userAgent: $0["user_agent"]?.stringValue ?? "")
    }
    deeplinks = Self.deeplinks(raw["simulator_deeplinks"])

    protectedBranches = Self.strings(raw["protected_branches"]).map { ListItem($0) }
    defaultBaseBranch = raw["default_base_branch"]?.stringValue ?? ""
    pullRequestTemplate = raw["pull_request_template"]?.stringValue ?? ""
    autoFetchMinutes = max(0, raw["auto_fetch_minutes"]?.intValue ?? 0)
    releaseNotes = (raw["release_note_patterns"]?.arrayValue ?? []).compactMap(Self.releasePattern)
    agentPrompt = raw["agent_prompt"]?.stringValue ?? ""
    saveChatHistory = raw["save_chat_history"]?.boolValue != false
    autoContinueOnLimit = raw["auto_continue_on_limit"]?.boolValue ?? false
    let llm = raw["llm"]?.objectValue ?? [:]
    llmRunner = llm["runner"]?.stringValue ?? ""
    llmModel = llm["model"]?.stringValue ?? ""
    relatedProjects = Self.objects(raw["related_projects"]).map {
      RelatedProject(path: $0["path"]?.stringValue ?? "", description: $0["description"]?.stringValue ?? "")
    }
    mcpServers = (raw["mcp_servers"]?.objectValue ?? [:]).sorted { $0.key < $1.key }.map {
      McpServer(name: $0.key, json: ConfigJSON.string($0.value))
    }
    disabledTools = Self.strings(raw["tools"]?["disabled"])
    let automations = raw["automations"]?.objectValue ?? [:]
    autonomyCeiling = automations["autonomy_ceiling"]?.stringValue.flatMap {
      Self.autonomyLevels.contains($0) ? $0 : nil
    }
    automationPathDenylist = Self.strings(automations["path_denylist"]).joined(separator: ", ")
    disabledAutomations = Self.strings(automations["disabled"]).joined(separator: ", ")
  }

  /// The file to write: `raw` with every owned key replaced by the draft's
  /// value, or removed when the draft leaves it empty.
  public func applied(to raw: [String: JSONValue]) -> [String: JSONValue] {
    var out = raw.filter { !Self.ownedKeys.contains($0.key) }
    func set(_ key: String, _ value: JSONValue?) { out[key] = value }

    // The desktop always writes `setup`, even empty.
    var setup = raw["setup"]?.objectValue ?? [:]
    setup["copy"] = Self.setupValue(copy, excludes: copyExcludes)
    setup["symlink"] = Self.setupValue(symlink, excludes: symlinkExcludes)
    setup["commands"] = Self.nonEmpty(commands.map(\.value).filter { !$0.isEmpty }.map(JSONValue.string))
    out["setup"] = .object(setup)

    set("terminals", Self.nonEmpty(terminals.filter { !$0.name.isEmpty || !$0.dir.isEmpty }.map {
      .object(["name": .string($0.name), "dir": .string($0.dir)])
    }))
    set("run", Self.nonEmpty(run.compactMap(Self.runValue)))
    set("workspace_env", Self.nonEmpty(workspaceEnv.compactMap(Self.envValue)))
    set("platforms", Self.nonEmpty(platforms.map(JSONValue.string)))
    set("agent_prompt", Self.trimmed(agentPrompt))
    set("related_projects", Self.nonEmpty(relatedProjects.compactMap { project in
      let path = project.path.trimmingCharacters(in: .whitespaces)
      guard !path.isEmpty else { return nil }
      return .object([
        "path": .string(path),
        "description": .string(project.description.trimmingCharacters(in: .whitespaces)),
      ])
    }))
    set("browser_url", Self.trimmed(browserUrl))
    set("browser_presets", Self.nonEmpty(browserPresets.compactMap(Self.presetValue)))
    set("simulator_deeplinks", Self.nonEmpty(Self.deeplinkValues(deeplinks)))
    set("save_chat_history", saveChatHistory ? nil : .bool(false))
    set("auto_continue_on_limit", autoContinueOnLimit ? .bool(true) : nil)
    set("protected_branches", Self.nonEmpty(protectedBranches.map(\.value).filter { !$0.isEmpty }.map(JSONValue.string)))
    set("pull_request_template", Self.trimmed(pullRequestTemplate))
    set("default_base_branch", Self.trimmed(defaultBaseBranch))
    set("single_runtime", singleRuntime ? .bool(true) : nil)
    var version = minArgusVersion.trimmingCharacters(in: .whitespaces)
    if version.first == "v" || version.first == "V" { version.removeFirst() }
    set("min_argus_version", version.isEmpty ? nil : .string(version))
    var servers: [String: JSONValue] = [:]
    for server in mcpServers where server.error == nil {
      servers[server.name.trimmingCharacters(in: .whitespaces)] = try? ConfigJSON.parse(server.json)
    }
    set("mcp_servers", servers.isEmpty ? nil : .object(servers))
    set("auto_fetch_minutes", autoFetchMinutes > 0 ? .number(Double(autoFetchMinutes)) : nil)
    set("release_note_patterns", Self.nonEmpty(releaseNotes.compactMap(Self.patternValue)))

    var llm = raw["llm"]?.objectValue ?? [:]
    llm["runner"] = Self.trimmed(llmRunner)
    llm["model"] = Self.trimmed(llmModel)
    set("llm", llm.isEmpty ? nil : .object(llm))
    var tools = raw["tools"]?.objectValue ?? [:]
    tools["disabled"] = Self.nonEmpty(disabledTools.map(JSONValue.string))
    set("tools", tools.isEmpty ? nil : .object(tools))
    var automations = raw["automations"]?.objectValue ?? [:]
    automations["autonomy_ceiling"] = autonomyCeiling.map(JSONValue.string)
    automations["path_denylist"] = Self.nonEmpty(Self.commaList(automationPathDenylist).map(JSONValue.string))
    automations["disabled"] = Self.nonEmpty(Self.commaList(disabledAutomations).map(JSONValue.string))
    set("automations", automations.isEmpty ? nil : .object(automations))
    return out
  }

  /// The release-note patterns as they'd be saved, for the live preview.
  public var releasePatternValues: [JSONValue] { releaseNotes.compactMap(Self.patternValue) }

  // MARK: Reading helpers

  static func strings(_ value: JSONValue?) -> [String] {
    (value?.arrayValue ?? []).compactMap(\.stringValue)
  }

  static func objects(_ value: JSONValue?) -> [[String: JSONValue]] {
    (value?.arrayValue ?? []).compactMap(\.objectValue)
  }

  /// A number or numeric string as the text a field shows.
  static func text(_ value: JSONValue?) -> String {
    switch value {
    case .number(let n): ConfigJSON.number(n)
    case .string(let s): s
    default: ""
    }
  }

  static func setupEntries(_ value: JSONValue?) -> ([ListItem], [String: JSONValue]) {
    var items: [ListItem] = []
    var excludes: [String: JSONValue] = [:]
    for entry in value?.arrayValue ?? [] {
      if let path = entry.stringValue {
        items.append(ListItem(path))
      } else if let path = entry["path"]?.stringValue {
        items.append(ListItem(path))
        if let exclude = entry["exclude"], exclude.arrayValue?.isEmpty == false { excludes[path] = exclude }
      }
    }
    return (items, excludes)
  }

  static func deeplinks(_ value: JSONValue?) -> [Deeplink] {
    objects(value).map { entry in
      if let children = entry["children"], children.arrayValue != nil {
        return Deeplink(label: entry["label"]?.stringValue ?? "", children: deeplinks(children))
      }
      return Deeplink(label: entry["label"]?.stringValue ?? "", url: entry["url"]?.stringValue ?? "")
    }
  }

  /// A bare glob string is a changesets pattern, as the host reads it.
  static func releasePattern(_ value: JSONValue) -> ReleasePattern? {
    if let glob = value.stringValue { return ReleasePattern(glob: glob) }
    guard let object = value.objectValue else { return nil }
    let format = object["format"]?.stringValue ?? "changesets"
    return ReleasePattern(
      glob: object["glob"]?.stringValue ?? "",
      format: ReleasePattern.formats.contains(format) ? format : "changesets",
      labels: objects(object["labels"]).map {
        .init(
          name: $0["name"]?.stringValue ?? "", selector: $0["selector"]?.stringValue ?? "",
          tone: $0["tone"]?.stringValue ?? "")
      })
  }

  // MARK: Writing helpers

  static func nonEmpty(_ values: [JSONValue]) -> JSONValue? {
    values.isEmpty ? nil : .array(values)
  }

  static func trimmed(_ text: String) -> JSONValue? {
    let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return value.isEmpty ? nil : .string(value)
  }

  static func commaList(_ text: String) -> [String] {
    text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
  }

  static func setupValue(_ items: [ListItem], excludes: [String: JSONValue]) -> JSONValue? {
    nonEmpty(items.map(\.value).filter { !$0.isEmpty }.map { path in
      excludes[path].map { .object(["path": .string(path), "exclude": $0]) } ?? .string(path)
    })
  }

  static func runValue(_ command: RunCommand) -> JSONValue? {
    let title = command.title.trimmingCharacters(in: .whitespaces)
    let line = command.command.trimmingCharacters(in: .whitespaces)
    guard !title.isEmpty, !line.isEmpty else { return nil }
    var out: [String: JSONValue] = [
      "title": .string(title), "command": .string(line), "restartOnRerun": .bool(command.restartOnRerun),
    ]
    out["cwd"] = trimmed(command.cwd)
    let requires = command.requires.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    out["requires"] = nonEmpty(requires.map(JSONValue.string))
    return .object(out)
  }

  static func envValue(_ env: EnvVar) -> JSONValue? {
    let name = env.name.trimmingCharacters(in: .whitespaces)
    guard !name.isEmpty else { return nil }
    var out: [String: JSONValue] = ["name": .string(name)]
    let base = Int(env.baseValue.trimmingCharacters(in: .whitespaces)).flatMap { $0 >= 0 ? $0 : nil }
    out["base_value"] = .number(Double(base ?? 8081))
    if let range = Int(env.range.trimmingCharacters(in: .whitespaces)), range > 0 {
      out["range"] = .number(Double(range))
    }
    if env.strategy != .hash { out["strategy"] = .string(env.strategy.rawValue) }
    return .object(out)
  }

  static func presetValue(_ preset: BrowserPreset) -> JSONValue? {
    let key = preset.key.trimmingCharacters(in: .whitespaces)
    guard !key.isEmpty else { return nil }
    func size(_ text: String, _ fallback: Int) -> JSONValue {
      let parsed = Int(text.trimmingCharacters(in: .whitespaces)).flatMap { $0 > 0 ? $0 : nil }
      return .number(Double(parsed ?? fallback))
    }
    var out: [String: JSONValue] = [
      "id": .string(key), "width": size(preset.width, 375), "height": size(preset.height, 667),
    ]
    out["label"] = trimmed(preset.label)
    out["user_agent"] = trimmed(preset.userAgent)
    return .object(out)
  }

  /// Unlabelled entries, links without a URL and empty folders are dropped.
  static func deeplinkValues(_ entries: [Deeplink]) -> [JSONValue] {
    entries.compactMap { entry in
      let label = entry.label.trimmingCharacters(in: .whitespaces)
      guard !label.isEmpty else { return nil }
      if let children = entry.children {
        let kids = deeplinkValues(children)
        return kids.isEmpty ? nil : .object(["label": .string(label), "children": .array(kids)])
      }
      let url = entry.url.trimmingCharacters(in: .whitespaces)
      return url.isEmpty ? nil : .object(["label": .string(label), "url": .string(url)])
    }
  }

  static func patternValue(_ pattern: ReleasePattern) -> JSONValue? {
    let glob = pattern.glob.trimmingCharacters(in: .whitespaces)
    guard !glob.isEmpty else { return nil }
    let labels: [JSONValue] = pattern.labels.compactMap { label in
      let name = label.name.trimmingCharacters(in: .whitespaces)
      let selector = label.selector.trimmingCharacters(in: .whitespaces)
      guard !name.isEmpty, !selector.isEmpty else { return nil }
      var out: [String: JSONValue] = ["name": .string(name), "selector": .string(selector)]
      if !label.tone.isEmpty { out["tone"] = .string(label.tone) }
      return .object(out)
    }
    return .object(["glob": .string(glob), "format": .string(pattern.format), "labels": .array(labels)])
  }
}
