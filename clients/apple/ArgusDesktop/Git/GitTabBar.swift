import ArgusUI
import SwiftUI

/// The git panel's views as quiet tabs, with the rest in a More menu.
struct GitTabBar: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  let workspace: GitWorkspace
  let view: GitRoute

  static let height: CGFloat = 34

  private var isProject: Bool { workspace.isProjectRoot }
  private var current: GitTab { GitTab(route: view) }

  var body: some View {
    // Titles while they fit, then icons only beside the selected tab's title.
    ViewThatFits(in: .horizontal) {
      bar(iconsOnly: false)
      bar(iconsOnly: true)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .frame(height: Self.height)
  }

  private func bar(iconsOnly: Bool) -> some View {
    HStack(spacing: 2) {
      ForEach(tabs, id: \.self) { tab in
        let selected = tab == current
        Button {
          pick(tab, via: .tabs)
        } label: {
          label(tab, titled: !iconsOnly || selected)
        }
        .buttonStyle(QuietTabButtonStyle(selected: selected))
        .help(tab.title)
        .accessibilityLabel(tab.title)
        .accessibilityAddTraits(selected ? .isSelected : [])
      }
      moreMenu(iconsOnly: iconsOnly)
    }
    .fixedSize()
  }

  private func label(_ tab: GitTab, titled: Bool) -> some View {
    HStack(spacing: 5) {
      Image(systemName: tab.symbol).font(.scaled(size: 11))
      if titled { Text(tab.title) }
      if tab == .conflicts && !workspace.workingCopy.conflictedFiles.isEmpty {
        Circle().fill(theme.error).frame(width: 6, height: 6)
          .accessibilityLabel("Needs attention")
      }
      if tab == .changes, workspace.workingCopy.changedCount > 0 {
        Text(workspace.workingCopy.changedCount, format: .number)
          .font(.scaled(size: 11).monospacedDigit())
          .foregroundStyle(theme.textMuted)
      }
    }
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
      HStack(spacing: 5) {
        Image(systemName: "ellipsis.circle").font(.scaled(size: 11))
        if !iconsOnly { Text("More") }
      }
    }
    .menuStyle(.button)
    .buttonStyle(QuietTabButtonStyle())
    .menuIndicator(.hidden)
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
