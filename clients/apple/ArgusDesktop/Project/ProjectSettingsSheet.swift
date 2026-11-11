import ArgusCore
import ArgusUI
import SwiftUI

/// Project Settings: the project's `.argus.json` plus its personal settings,
/// in the desktop dialog's sections.
struct ProjectSettingsSheet: View {
  let repoRoot: String
  @Environment(DesktopModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme
  @State private var settings: ProjectSettingsModel
  @State private var section = ProjectSettingsSection.setup

  init(repoRoot: String) {
    self.repoRoot = repoRoot
    _settings = State(initialValue: ProjectSettingsModel(repoRoot: repoRoot))
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
      guard let backend = model.backend else { return }
      await model.store.loadRunners()
      await settings.load(backend)
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
      }
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

  static let groups: [(title: String, sections: [ProjectSettingsSection])] = [
    ("Workspace", [.setup, .workspaceEnv]),
    ("Runtime", [.run, .terminals, .browser, .deeplinks]),
    ("Workflow", [.branchProtection, .releaseNotes, .agent, .llm, .relatedProjects, .automations, .tools]),
    ("Personal", [.branchPrefix, .worktreeLocation]),
    ("Reference", [.preview]),
  ]
}

/// The selected section's header and form.
private struct ProjectSettingsDetail: View {
  let section: ProjectSettingsSection
  @Bindable var settings: ProjectSettingsModel

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
    .id(section)
  }
}

#if DEBUG
  extension Notification.Name {
    static let devProjectSection = Notification.Name("argus.dev.projectSection")
  }
#endif
