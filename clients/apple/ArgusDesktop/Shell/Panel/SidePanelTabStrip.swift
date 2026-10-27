import ArgusCore
import ArgusUI
import SwiftUI

/// The side panel's slim strip: its tabs and "+", then maximize and close.
struct SidePanelTabStrip: View {
  @Environment(DesktopModel.self) private var model
  @Environment(TerminalsStore.self) private var terminals
  let sessionId: String?
  let tabs: [PanelTab]
  let selected: PanelTab?
  @State private var renaming: String?
  @State private var draft = ""

  private var maximized: Bool { model.panels.isMaximized(sessionId) }

  var body: some View {
    HStack(spacing: 2) {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 2) {
          ForEach(tabs) { tab in
            button(tab)
              .draggable(tab.id)
              .dropDestination(for: String.self) { ids, _ in
                guard let id = ids.first else { return false }
                model.panels.move(id, to: tab.id, session: sessionId, terminals: model.panelTerminalIds(sessionId))
                return true
              }
          }
          addMenu
        }
      }
      Button {
        model.panels.toggleMaximized(sessionId)
      } label: {
        Label(
          maximized ? "Restore Panel" : "Maximize Panel",
          systemImage: maximized ? "arrow.down.right.and.arrow.up.left" : Icon.expand)
      }
      .buttonStyle(FlatIconButtonStyle(selected: maximized, size: 22))
      .help(maximized ? "Restore the panel" : "Fill the window with the panel")
      Button {
        model.toggleSidePanel(via: .button)
      } label: {
        Label("Close Panel", systemImage: Icon.close)
      }
      .buttonStyle(FlatIconButtonStyle(size: 22))
      .help("Close the panel (⌘J)")
    }
    .labelStyle(.iconOnly)
    .padding(.horizontal, 8)
    // A scroll view takes all the height it's offered; a tab strip is one row.
    .frame(height: 34)
  }

  private var addMenu: some View {
    ChromeMenuButton {
      for kind in PanelTabKind.allCases {
        ChromeMenuItem(
          kind.title, icon: .symbol(kind.symbol), disabled: !model.panelKindAvailable(kind), key: kind.key
        ) { model.addPanelTab(kind, via: .tabMenu) }
      }
    } label: { open in
      Label("Open Tab", systemImage: Icon.plus)
        .labelStyle(.iconOnly)
    }
    .buttonStyle(FlatIconButtonStyle(size: 22))
    .help("Open a tab")
  }

  private func button(_ tab: PanelTab) -> some View {
    let terminal = tab.terminalId.flatMap { id in sessionId.flatMap { terminals.tabs($0).first { $0.id == id } } }
    return SidePanelTabButton(
      title: title(tab, terminal: terminal), selected: tab == selected,
      closable: terminal?.closable ?? true,
      renaming: renaming == tab.id, draft: $draft,
      select: { model.panels.select(tab.id, session: sessionId) },
      startRename: terminal.flatMap { terminal in
        terminal.isRun ? nil : {
          draft = terminal.title
          renaming = tab.id
        }
      },
      commitRename: { commitRename(terminal) },
      cancelRename: { renaming = nil },
      close: { model.closePanelTab(tab, session: sessionId) }
    ) {
      if let terminal {
        TerminalTabIcon(tab: terminal)
      } else {
        Image(systemName: tab.kind.symbol).font(.scaled(size: 10))
      }
    }
  }

  private func title(_ tab: PanelTab, terminal: TerminalsStore.Tab?) -> String {
    if let terminal { return terminal.title }
    if tab.kind == .pullRequest, let session = sessionId.flatMap(model.session),
      let pr = model.sessionPullRequest(session)
    {
      return "#\(pr.number)"
    }
    return tab.kind.title
  }

  private func commitRename(_ terminal: TerminalsStore.Tab?) {
    renaming = nil
    guard let terminal, draft.trimmingCharacters(in: .whitespaces) != terminal.title else { return }
    MacTelemetry.capture(.terminalUsed(action: .rename))
    Task { await terminals.rename(terminal.id, to: draft) }
  }
}

/// One tab: icon and title, a close button on hover, a quiet fill when selected.
/// Double-click renames a shell.
struct SidePanelTabButton<Glyph: View>: View {
  @Environment(\.theme) private var theme
  let title: String
  let selected: Bool
  let closable: Bool
  let renaming: Bool
  @Binding var draft: String
  let select: () -> Void
  let startRename: (() -> Void)?
  let commitRename: () -> Void
  let cancelRename: () -> Void
  let close: () -> Void
  @ViewBuilder let icon: () -> Glyph
  @State private var hovering = false
  @FocusState private var fieldFocused: Bool

  var body: some View {
    HStack(spacing: 6) {
      icon().frame(width: 12)
      if renaming {
        TextField("Name", text: $draft)
          .textFieldStyle(.plain)
          .frame(width: 110)
          .focused($fieldFocused)
          .onSubmit(commitRename)
          .onExitCommand(perform: cancelRename)
          .onAppear { fieldFocused = true }
      } else {
        Text(title).lineLimit(1)
      }
      if closable && !renaming {
        Button(action: close) {
          Image(systemName: "xmark").font(.scaled(size: 9, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .opacity(hovering ? 1 : 0)
        .help("Close tab")
        .accessibilityLabel("Close \(title)")
      }
    }
    .font(.scaled(size: 12))
    .foregroundStyle(selected ? theme.text : theme.textSecondary)
    .padding(.leading, 8)
    .padding(.trailing, closable ? 6 : 8)
    .padding(.vertical, 4)
    .background(
      selected || hovering ? theme.selection.opacity(selected ? 1 : 0.55) : .clear, in: .rect(cornerRadius: 6)
    )
    .contentShape(.rect)
    .onTapGesture(perform: select)
    .simultaneousGesture(TapGesture(count: 2).onEnded { startRename?() })
    .onHover { hovering = $0 }
    .pointerStyle(renaming ? nil : .link)
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    .contextMenu {
      if let startRename { Button("Rename…", action: startRename) }
      if closable { Button("Close Tab", action: close) }
    }
    .onChange(of: fieldFocused) { _, focused in
      if !focused && renaming { commitRename() }
    }
  }
}
