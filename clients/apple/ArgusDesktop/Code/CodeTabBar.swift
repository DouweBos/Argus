import ArgusUI
import SwiftUI

/// The session's open files. Italic is the preview tab (the next single click
/// replaces it), a dot unsaved edits, strikethrough a file deleted on disk.
struct CodeTabBar: View {
  @Environment(DesktopModel.self) private var model
  let code: CodeSession
  let activePath: String?

  var body: some View {
    HStack(spacing: 0) {
      Button {
        code.navigatorVisible.toggle()
      } label: {
        Label("Toggle Navigator", systemImage: "sidebar.left")
      }
      .buttonStyle(FlatIconButtonStyle(selected: code.navigatorVisible, size: 24))
      .help(code.navigatorVisible ? "Hide navigator (⌘B)" : "Show navigator (⌘B)")
      .padding(.horizontal, 6)
      ScrollViewReader { proxy in
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 2) {
            ForEach(code.tabs.tabs, id: \.path) { tab in
              CodeTabItem(
                tab: tab, file: code.files[tab.path], selected: tab.path == activePath,
                select: { code.navigate(to: tab.path, source: .history) },
                pin: { code.pin(tab.path) },
                close: { Task { await code.close(tab.path, active: activePath) } },
                closeOthers: { closeOthers(keeping: tab.path) }
              )
              .id(tab.path)
            }
          }
          .padding(.vertical, 4)
        }
        .onChange(of: activePath, initial: true) { _, path in
          if let path { proxy.scrollTo(path) }
        }
      }
    }
    .frame(height: Self.height)
  }

  static let height: CGFloat = 34

  private func closeOthers(keeping path: String) {
    Task {
      for other in code.tabs.paths where other != path {
        await code.close(other, active: path)
      }
      if activePath != path { code.navigate(to: path, source: .history) }
    }
  }
}

private struct CodeTabItem: View {
  @Environment(\.theme) private var theme
  let tab: CodeTabList.Tab
  let file: CodeFile?
  let selected: Bool
  let select: () -> Void
  let pin: () -> Void
  let close: () -> Void
  let closeOthers: () -> Void
  @State private var hovering = false

  private var name: String { (tab.path as NSString).lastPathComponent }
  private var deleted: Bool { file?.disk.isDeleted ?? false }

  var body: some View {
    HStack(spacing: 6) {
      FileTypeIcon(path: tab.path, size: 14).opacity(deleted ? 0.5 : 1)
      Text(name)
        .italic(tab.isPreview)
        .strikethrough(deleted)
        .foregroundStyle(deleted ? theme.textMuted : selected ? theme.text : theme.textSecondary)
        .lineLimit(1)
      ZStack {
        if file?.isDirty == true && !hovering {
          Circle().fill(theme.textSecondary).frame(width: 7, height: 7)
            .accessibilityLabel("Unsaved changes")
        } else {
          Button(action: close) {
            Image(systemName: "xmark").font(.scaled(size: 9, weight: .semibold))
          }
          .buttonStyle(.plain)
          .foregroundStyle(theme.textSecondary)
          .opacity(selected || hovering ? 1 : 0)
          .help("Close (⌘W)")
        }
      }
      .frame(width: 12, height: 12)
    }
    .font(.scaled(size: 12))
    .padding(.leading, 10)
    .padding(.trailing, 6)
    .padding(.vertical, 4)
    .background {
      if selected || hovering {
        RoundedRectangle(cornerRadius: 6).fill(theme.selection.opacity(selected ? 1 : 0.55))
      }
    }
    .contentShape(Rectangle())
    .gesture(TapGesture(count: 2).onEnded(pin))
    .simultaneousGesture(TapGesture().onEnded(select))
    .onHover { hovering = $0 }
    .help(tab.path)
    .contextMenu {
      Button("Close", action: close)
      Button("Close Others", action: closeOthers)
      if tab.isPreview { Button("Keep Open", action: pin) }
      Divider()
      Button("Copy Path") { Clipboard.copy(tab.path) }
    }
  }
}
