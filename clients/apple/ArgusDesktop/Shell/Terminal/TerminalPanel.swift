import ArgusCore
import ArgusUI
import SwiftUI

/// A session's terminals: tabs over the host's PTYs, run commands pinned
/// first. Every tab stays drawn while the panel is up, so switching is instant.
struct TerminalPanel: View {
  @Environment(TerminalsStore.self) private var terminals
  @Environment(\.theme) private var theme
  let session: RemoteSession
  @State private var search = TerminalSearchState()
  @State private var renaming: String?
  @State private var draft = ""

  private var tabs: [TerminalsStore.Tab] { terminals.tabs(session.id) }
  private var active: TerminalsStore.Tab? { terminals.active(session.id) }

  var body: some View {
    VStack(spacing: 0) {
      tabBar
      Divider()
      ZStack {
        if tabs.isEmpty {
          ContentUnavailableView {
            Label("No terminals open", systemImage: "terminal")
          } actions: {
            Button("New Terminal", action: newShell)
          }
        }
        ForEach(tabs) { tab in
          TerminalSurface(
            terminalId: tab.id, isActive: tab.id == active?.id, search: search,
            onNewTab: newShell, onClose: { close(tab) }
          )
          .padding(.leading, 6)
          .opacity(tab.id == active?.id ? 1 : 0)
          .allowsHitTesting(tab.id == active?.id)
          .accessibilityHidden(tab.id != active?.id)
        }
      }
      // An overlay, so the bar never widens the panel.
      .overlay(alignment: .topTrailing) {
        if search.visible {
          TerminalFindBar(search: search).padding(8)
        }
      }
    }
    .task(id: session.id) {
      await terminals.open(sessionId: session.id, repoRoot: session.repoRoot)
    }
  }

  private var tabBar: some View {
    HStack(spacing: 4) {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 4) {
          ForEach(tabs) { tab in
            TerminalTabButton(
              tab: tab, selected: tab.id == active?.id, renaming: renaming == tab.id,
              draft: $draft,
              select: { terminals.select(tab.id, in: session.id) },
              startRename: {
                draft = tab.title
                renaming = tab.id
              },
              commitRename: { commitRename(tab) },
              cancelRename: { renaming = nil },
              close: { close(tab) })
          }
        }
      }
      Button(action: newShell) { Image(systemName: "plus") }
        .buttonStyle(.borderless)
        .help("New terminal")
        .accessibilityLabel("New terminal")
    }
    .padding(.horizontal, 8)
    .frame(height: 32)
  }

  private func newShell() {
    MacTelemetry.capture(.terminalUsed(action: .newShell))
    Task { await terminals.newShell(sessionId: session.id) }
  }

  private func close(_ tab: TerminalsStore.Tab) {
    // A running run is stopped from the run control, not closed away.
    guard !(tab.isRun && !tab.exited) else { return }
    MacTelemetry.capture(.terminalUsed(action: .close))
    Task { await terminals.close(tab.id) }
  }

  private func commitRename(_ tab: TerminalsStore.Tab) {
    renaming = nil
    guard draft.trimmingCharacters(in: .whitespaces) != tab.title else { return }
    MacTelemetry.capture(.terminalUsed(action: .rename))
    Task { await terminals.rename(tab.id, to: draft) }
  }
}

/// One tab: a spinner while a run is going, a play glyph for a stopped run,
/// else a terminal glyph; double-click renames a shell.
struct TerminalTabButton: View {
  @Environment(\.theme) private var theme
  let tab: TerminalsStore.Tab
  let selected: Bool
  let renaming: Bool
  @Binding var draft: String
  let select: () -> Void
  let startRename: () -> Void
  let commitRename: () -> Void
  let cancelRename: () -> Void
  let close: () -> Void
  @State private var hovering = false
  @FocusState private var fieldFocused: Bool

  private var closable: Bool { !(tab.isRun && !tab.exited) }

  var body: some View {
    HStack(spacing: 6) {
      if renaming {
        icon.frame(width: 12)
        TextField("Name", text: $draft)
          .textFieldStyle(.plain)
          .frame(width: 110)
          .focused($fieldFocused)
          .onSubmit(commitRename)
          .onExitCommand(perform: cancelRename)
          .onAppear { fieldFocused = true }
      } else {
        Button(action: select) {
          HStack(spacing: 6) {
            icon.frame(width: 12)
            Text(tab.title).lineLimit(1)
          }
        }
        .buttonStyle(.plain)
        .simultaneousGesture(TapGesture(count: 2).onEnded { if !tab.isRun { startRename() } })
      }
      if closable && !renaming {
        Button(action: close) {
          Image(systemName: "xmark").font(.system(size: 9, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .opacity(selected || hovering ? 1 : 0)
        .help("Close terminal")
        .accessibilityLabel("Close \(tab.title)")
      }
    }
    .font(.system(size: 12))
    .padding(.horizontal, 8)
    .padding(.vertical, 4)
    .background(selected ? AnyShapeStyle(.selection) : AnyShapeStyle(.clear), in: .rect(cornerRadius: 6))
    .onHover { hovering = $0 }
    .contextMenu {
      if !tab.isRun { Button("Rename…", action: startRename) }
      if closable { Button("Close Terminal", action: close) }
    }
    .onChange(of: fieldFocused) { _, focused in
      if !focused && renaming { commitRename() }
    }
  }

  @ViewBuilder
  private var icon: some View {
    if tab.isRun && !tab.exited {
      ProgressView().controlSize(.mini)
    } else {
      Image(systemName: tab.isRun ? "play.fill" : "terminal")
        .font(.system(size: 10))
        .foregroundStyle(tab.exitCode.map { $0 == 0 ? theme.textMuted : theme.error } ?? theme.textMuted)
    }
  }
}
