import ArgusUI
import GroveUIKit
import SwiftUI

/// The git panel's views as GroveUIKit's pills, Grove's toolbar bar, with the rest in a More menu. Only navigates:
/// the route says which pill is lit.
struct GitViewPills: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  let workspace: GitWorkspace
  let view: GitRoute

  static let height: CGFloat = 40

  private var isProject: Bool { workspace.isProjectRoot }
  private var current: GitTab { GitTab(route: view) }

  var body: some View {
    // Titles while they fit, then icons beside the selected pill's title, as in Grove's narrow windows.
    ViewThatFits(in: .horizontal) {
      bar(iconsOnly: false)
      bar(iconsOnly: true)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .frame(height: Self.height)
  }

  private func bar(iconsOnly: Bool) -> some View {
    HStack(spacing: 4) {
      GitPillTabBar(tabs: tabs.map(pill), selection: current, compact: true, iconsOnly: iconsOnly) {
        pick($0, via: .tabs)
      }
      moreMenu(iconsOnly: iconsOnly)
    }
    .fixedSize()
  }

  private func pill(_ tab: GitTab) -> GitPillTab<GitTab> {
    GitPillTab(
      id: tab, title: tab.title, symbol: tab.symbol,
      badge: tab == .changes ? workspace.workingCopy.changedCount : nil,
      indicator: tab == .conflicts && !workspace.workingCopy.conflictedFiles.isEmpty)
  }

  /// The primary tabs, Conflicts while an operation needs it, and whichever other view is open.
  private var tabs: [GitTab] {
    var tabs = GitTab.primary(isProject: isProject)
    if current == .conflicts || workspace.workingCopy.isInOperation || !workspace.workingCopy.conflictedFiles.isEmpty {
      tabs.append(.conflicts)
    }
    if !tabs.contains(current) { tabs.append(current) }
    return tabs
  }

  private func moreMenu(iconsOnly: Bool) -> some View {
    Menu {
      ForEach(GitTab.secondary(isProject: isProject), id: \.self) { tab in
        Button { pick(tab, via: .more) } label: { Label(tab.title, systemImage: tab.symbol) }
      }
    } label: {
      HStack(spacing: 6) {
        Image(systemName: "ellipsis.circle")
        if !iconsOnly { Text("More") }
      }
      .font(.scaled(size: 13, weight: .medium))
      .foregroundStyle(theme.text)
      .padding(.horizontal, 12)
      .padding(.vertical, 5)
      .contentShape(Capsule())
    }
    .menuStyle(.borderlessButton)
    .menuIndicator(.hidden)
    .clickable()
    .fixedSize()
    .help("More git views")
    .accessibilityLabel("More git views")
  }

  private func pick(_ tab: GitTab, via: MacTelemetryEvent.GitViewSource) {
    // History stays lit on a ref's history; picking it again shows all of it.
    guard let route = tab.route, route != view, tab != current || tab == .history else { return }
    MacTelemetry.capture(.gitViewPicked(view: route.segment, via: via))
    model.navigate(.sessionGit(id: workspace.sessionId, view: route))
  }
}
