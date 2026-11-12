import ArgusCore
import ArgusUI
import SwiftUI
import UniformTypeIdentifiers

/// Project Settings: the project's config (stored on this Mac, over a
/// checked-in `.argus.json` if any) plus its personal settings.
struct ProjectSettingsSheet: View {
  let repoRoot: String
  @Environment(DesktopModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme
  @State private var settings: ProjectSettingsModel
  @State private var section = ProjectSettingsSection.setup

  @State private var confirmingImport: String?

  init(repoRoot: String, settings: ProjectSettingsModel? = nil, section: ProjectSettingsSection = .setup) {
    self.repoRoot = repoRoot
    _settings = State(initialValue: settings ?? ProjectSettingsModel(repoRoot: repoRoot))
    _section = State(initialValue: section)
  }

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 0) {
        sidebar.frame(width: 210)
        Divider()
        Group {
          if settings.loaded {
            ProjectSettingsDetail(section: section, settings: settings)
          } else {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
          }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      }
      Divider()
      footer
    }
    .frame(width: 920, height: 660)
    .background(theme.bg)
    .modifier(RunnerSetupPresenter(window: .projectSettings))
    .task {
      guard !settings.loaded, let backend = model.backend else { return }
      await model.store.loadRunners()
      await settings.load(backend)
    }
    .confirmationDialog(
      "Replace this project's config on this Mac?",
      isPresented: Binding(get: { confirmingImport != nil }, set: { if !$0 { confirmingImport = nil } })
    ) {
      Button("Replace", role: .destructive) {
        guard let content = confirmingImport, let backend = model.backend else { return }
        Task { await settings.importConfig(content, backend) }
      }
    } message: {
      Text(
        settings.isDirty
          ? "The imported file replaces the config stored on this Mac, and your unsaved changes are discarded."
          : "The imported file replaces the config stored on this Mac. A checked-in .argus.json is left as it is.")
    }
    .onAppear { MacTelemetry.capture(.screenViewed(screen: "/project-settings")) }
    #if DEBUG
      .onReceive(NotificationCenter.default.publisher(for: .devProjectSection)) { note in
        if let raw = note.object as? String, let next = ProjectSettingsSection(rawValue: raw) { section = next }
      }
    #endif
  }

  private var sidebar: some View {
    List(selection: $section) {
      ForEach(ProjectSettingsSection.groups, id: \.title) { group in
        Section(group.title) {
          ForEach(group.sections) { item in
            SidebarLabel(item.title, systemImage: item.icon).tag(item)
          }
        }
      }
    }
    .listStyle(.sidebar)
  }

  private var footer: some View {
    HStack(spacing: 10) {
      VStack(alignment: .leading, spacing: 2) {
        Text(URL(fileURLWithPath: repoRoot).lastPathComponent).font(.scaled(.headline))
        Text(HostScopedPath.path(repoRoot)).font(.scaled(.caption)).foregroundStyle(theme.textMuted).lineLimit(1).truncationMode(.middle)
        Label(storedLabel, systemImage: "laptopcomputer").font(.scaled(.caption)).foregroundStyle(theme.textMuted)
      }
      Button("Import…", action: importFile)
        .padding(.leading, 12)
        .buttonStyle(.argusBorderless)
        .disabled(!settings.loaded || settings.transferring)
        .help("Replace this project's config on this Mac with an .argus.json file")
      Button("Export…", action: exportFile)
        .buttonStyle(.argusBorderless)
        .disabled(!settings.loaded || settings.transferring || settings.isDirty)
        .help(settings.isDirty ? "Save your changes before exporting" : "Save the effective config as an .argus.json file")
      Spacer()
      if let error = settings.error {
        Text(error).font(.scaled(.caption)).foregroundStyle(theme.error).lineLimit(2)
      }
      Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
      Button(settings.saving ? "Saving…" : "Save") {
        guard let backend = model.backend else { return }
        Task { if await settings.save(backend) { dismiss() } }
      }
      .buttonStyle(.borderedProminent)
      .keyboardShortcut(.defaultAction)
      .disabled(!settings.loaded || settings.saving)
    }
    .padding(14)
    // The grouped form above paints the window background; the sheet's own darker bg showed through here.
    .background(Color(nsColor: .windowBackgroundColor))
  }
}

extension ProjectSettingsSheet {
  private var storedLabel: String {
    settings.repoFile ? "Saved on this Mac, over the checked-in .argus.json" : "Saved on this Mac"
  }

  private func importFile() {
    let panel = NSOpenPanel()
    panel.allowedContentTypes = [.json]
    panel.allowsMultipleSelection = false
    panel.showsHiddenFiles = true
    panel.message = "Choose an .argus.json to use as this project's config on this Mac."
    guard panel.runModal() == .OK, let url = panel.url else { return }
    do {
      confirmingImport = try String(contentsOf: url, encoding: .utf8)
    } catch {
      settings.error = "Couldn't read \(url.lastPathComponent): \(error.localizedDescription)"
    }
  }

  private func exportFile() {
    guard let backend = model.backend else { return }
    Task {
      guard let text = await settings.exportText(backend) else { return }
      let panel = NSSavePanel()
      panel.allowedContentTypes = [.json]
      panel.nameFieldStringValue = "\(URL(fileURLWithPath: repoRoot).lastPathComponent).argus.json"
      panel.message = "Export this project's effective config in .argus.json format."
      guard panel.runModal() == .OK, let url = panel.url else { return }
      do {
        try text.write(to: url, atomically: true, encoding: .utf8)
      } catch {
        settings.error = "Couldn't write \(url.lastPathComponent): \(error.localizedDescription)"
      }
    }
  }
}

enum ProjectSettingsSection: String, Identifiable, Hashable, CaseIterable {
  case setup, workspaceEnv
  case run, terminals, browser, deeplinks
  case branchProtection, releaseNotes, agent, llm, relatedProjects, automations, tools
  case branchPrefix, worktreeLocation
  case preview

  var id: String { rawValue }

  var title: String {
    switch self {
    case .setup: "Setup"
    case .workspaceEnv: "Workspace env"
    case .run: "Run commands"
    case .terminals: "Terminals"
    case .browser: "Browser"
    case .deeplinks: "Deep links"
    case .branchProtection: "Branch protection"
    case .releaseNotes: "Release notes"
    case .agent: "Agent"
    case .llm: "LLM"
    case .relatedProjects: "Related projects"
    case .automations: "Automations"
    case .tools: "Tools"
    case .branchPrefix: "Branch prefix"
    case .worktreeLocation: "Worktree location"
    case .preview: "JSON preview"
    }
  }

  var icon: String {
    switch self {
    case .setup: "folder"
    case .workspaceEnv: "number"
    case .run: "play"
    case .terminals: "terminal"
    case .browser: "globe"
    case .deeplinks: "link"
    case .branchProtection: "lock.shield"
    case .releaseNotes: "doc.text"
    case .agent: "sparkles"
    case .llm: "cpu"
    case .relatedProjects: "square.stack.3d.up"
    case .automations: "clock.arrow.circlepath"
    case .tools: "wrench.and.screwdriver"
    case .branchPrefix: "arrow.triangle.branch"
    case .worktreeLocation: "externaldrive"
    case .preview: "curlybraces"
    }
  }

  /// The config keys the section edits; empty for personal and reference sections.
  var configKeys: [String] {
    switch self {
    case .setup: ["setup"]
    case .workspaceEnv: ["workspace_env"]
    case .run: ["run", "single_runtime"]
    case .terminals: ["terminals"]
    case .browser: ["browser_url", "browser_presets"]
    case .deeplinks: ["simulator_deeplinks"]
    case .branchProtection: ["protected_branches", "default_base_branch", "auto_fetch_minutes"]
    case .releaseNotes: ["release_note_patterns"]
    case .agent: ["auto_continue_on_limit"]
    case .llm: ["llm"]
    case .relatedProjects: ["related_projects"]
    case .automations: ["automations"]
    case .tools: ["tools"]
    case .branchPrefix, .worktreeLocation, .preview: []
    }
  }

  static let groups: [(title: String, sections: [ProjectSettingsSection])] = [
    ("Workspace", [.setup, .workspaceEnv]),
    ("Runtime", [.run, .terminals, .browser, .deeplinks]),
    ("Workflow", [.branchProtection, .releaseNotes, .agent, .llm, .relatedProjects, .automations, .tools]),
    ("Personal", [.branchPrefix, .worktreeLocation]),
    ("Reference", [.preview]),
  ]
}

/// The selected section's header and form.
struct ProjectSettingsDetail: View {
  let section: ProjectSettingsSection
  @Bindable var settings: ProjectSettingsModel

  private var sourceNote: ConfigSourceNote? {
    section.configKeys.isEmpty
      ? nil : ConfigSourceNote(source: settings.source(of: section.configKeys), repoFile: settings.repoFile)
  }

  var body: some View {
    Form {
      switch section {
      case .setup: SetupSection(draft: $settings.draft)
      case .workspaceEnv: WorkspaceEnvSection(draft: $settings.draft)
      case .run: RunCommandsSection(draft: $settings.draft)
      case .terminals: TerminalsSection(draft: $settings.draft)
      case .browser: BrowserSection(draft: $settings.draft)
      case .deeplinks: DeeplinksSection(draft: $settings.draft)
      case .branchProtection: BranchProtectionSection(draft: $settings.draft)
      case .releaseNotes: ReleaseNotesSection(draft: $settings.draft)
      case .agent: AgentSection(draft: $settings.draft)
      case .llm: LLMSection(draft: $settings.draft)
      case .relatedProjects: RelatedProjectsSection(draft: $settings.draft)
      case .automations: ProjectAutomationsSection(draft: $settings.draft)
      case .tools: ProjectToolsSection(draft: $settings.draft)
      case .branchPrefix: BranchPrefixSection(settings: settings)
      case .worktreeLocation: WorktreeLocationSection(settings: settings)
      case .preview: JSONPreviewSection(settings: settings)
      }
    }
    .formStyle(.grouped)
    .toggleStyle(.argusSwitch)
    .environment(\.configSourceNote, sourceNote)
    .id(section)
  }
}

#if DEBUG
  extension Notification.Name {
    static let devProjectSection = Notification.Name("argus.dev.projectSection")
  }
#endif
