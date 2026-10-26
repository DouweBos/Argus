import ArgusCore
import ArgusUI
import SwiftUI

/// What the sidebar list is narrowed to: a search, and one project. The
/// project pick is kept per Argus home; the search is for the moment.
@MainActor @Observable
final class SidebarFilter {
  private static let key = "sidebar.projectFilter"

  var search = "" {
    didSet {
      if oldValue.isEmpty, !search.isEmpty { MacTelemetry.capture(.sidebarFiltered(kind: .search)) }
    }
  }

  var project: String? {
    didSet { HomeDefaults.shared.set(project, forKey: Self.key) }
  }

  init() {
    project = HomeDefaults.shared.string(forKey: Self.key)
  }

  var query: String { search.trimmingCharacters(in: .whitespaces) }
  var isSearching: Bool { !query.isEmpty }
  var isActive: Bool { isSearching || project != nil }

  func matches(_ text: String) -> Bool {
    text.localizedCaseInsensitiveContains(query)
  }
}

/// The top of the sidebar: search, then project filter, add project and new session.
struct SidebarTopBar: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(\.theme) private var theme
  @Bindable var filter: SidebarFilter
  let showsHosts: Bool

  var body: some View {
    HStack(spacing: 2) {
      ChromeSearchField(text: $filter.search)
      if showsHosts { MachinesMenu() }
      projectFilter
      addProject
      newSession
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 6)
    // A project that's gone leaves nothing to narrow to.
    .onChange(of: store.projects.map(\.repoRoot)) { _, roots in
      if let project = filter.project, store.projectsLoaded, !roots.contains(project) { filter.project = nil }
    }
  }

  private var projectFilter: some View {
    SidebarMenuButton(
      "Filter by Project",
      systemImage: filter.project == nil ? "line.3.horizontal.decrease" : "line.3.horizontal.decrease.circle.fill",
      selected: filter.project != nil
    ) {
      ChromeMenuItem("All Projects", icon: .symbol("square.grid.2x2"), checked: filter.project == nil) { pick(nil) }
      ChromeMenuEntry.divider
      for project in store.projects {
        ChromeMenuItem(project.name, icon: .badge(project.name), checked: filter.project == project.repoRoot) {
          pick(project.repoRoot)
        }
      }
      if let repo = filter.project {
        ChromeMenuEntry.divider
        ChromeMenuItem("Project Settings…", icon: .symbol(Icon.gear)) { model.projectSettingsRepo = repo }
      }
    }
    .help(filter.project.flatMap { root in store.projects.first { $0.repoRoot == root }?.name }
      .map { "Showing \($0) only" } ?? "Filter by project")
  }

  private var addProject: some View {
    SidebarMenuButton("Add Project", systemImage: "folder.badge.plus") {
      ChromeMenuItem("Add Project…", icon: .symbol("folder.badge.plus"), shortcut: "⌘O") { model.addingProject = true }
      ChromeMenuItem("Import Projects from Claude Code…", icon: .symbol(Icon.download)) {
        model.importingCliProjects = true
      }
    }
    .help("Add a project (⌘O)")
  }

  private var newSession: some View {
    SidebarMenuButton("New Session", systemImage: "square.and.pencil") {
      if store.projects.isEmpty {
        Task { await model.newScratchPad() }
      } else {
        model.requestNewSession()
      }
    } entries: {
      for project in store.projects {
        ChromeMenuItem("New Session in \(project.name)…", icon: .badge(project.name)) {
          model.newSessionProject = project
        }
      }
      ChromeMenuEntry.divider
      ChromeMenuItem("New Scratch Pad", icon: .symbol(Icon.scratchPad)) { Task { await model.newScratchPad() } }
    }
    .help("New session (⌘N) — hold for more")
  }

  private func pick(_ repoRoot: String?) {
    guard filter.project != repoRoot else { return }
    filter.project = repoRoot
    MacTelemetry.capture(.sidebarFiltered(kind: .project))
  }
}

/// A dropdown behind a flat icon button, lit while it's open or narrowing the list.
/// Given a primary action, a click runs it and a long press opens the dropdown.
struct SidebarMenuButton: View {
  let title: String
  let systemImage: String
  var selected = false
  var primaryAction: (() -> Void)?
  let entries: () -> [ChromeMenuEntry]
  @State private var open = false

  init(
    _ title: String, systemImage: String, selected: Bool = false, primaryAction: (() -> Void)? = nil,
    @ChromeMenuBuilder entries: @escaping () -> [ChromeMenuEntry]
  ) {
    self.title = title
    self.systemImage = systemImage
    self.selected = selected
    self.primaryAction = primaryAction
    self.entries = entries
  }

  var body: some View {
    ChromeMenuButton(isPresented: $open, primaryAction: primaryAction, entries: entries) { _ in
      Label(title, systemImage: systemImage)
    }
    .buttonStyle(FlatIconButtonStyle(selected: selected || open))
    .fixedSize()
  }
}
