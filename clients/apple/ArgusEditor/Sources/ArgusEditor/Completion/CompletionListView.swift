import AppKit
import ArgusUI
import SwiftUI

/// The completion list: a keyboard-driven column of items with the selected item's docs below.
struct CompletionListView: View {
  @Bindable var model: CompletionModel
  @Environment(\.theme) private var theme

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(Array(model.items.enumerated()), id: \.element.id) { index, item in
              row(item, selected: index == model.selected)
                .id(item.id)
                .contentShape(Rectangle())
                .onTapGesture { model.onAccept?(index) }
            }
          }
        }
        .frame(height: min(CGFloat(model.items.count), 9) * 22)
        .onChange(of: model.selected) { _, selected in
          guard model.items.indices.contains(selected) else { return }
          proxy.scrollTo(model.items[selected].id)
        }
      }
      if let item = model.selectedItem, let docs = model.documentation[item.id] ?? item.documentation, !docs.isEmpty {
        Divider()
        ScrollView {
          MarkdownView(text: docs, baseSize: 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(8)
        }
        .frame(maxHeight: 140)
      }
    }
    .frame(width: 420)
    .background(theme.bgSecondary)
  }

  private func row(_ item: EditorCompletionItem, selected: Bool) -> some View {
    HStack(spacing: 8) {
      Text(CompletionKindBadge.letter(item.kind))
        .font(.system(size: 10, weight: .bold, design: .monospaced))
        .foregroundStyle(theme.onAccent)
        .frame(width: 16, height: 16)
        .background(CompletionKindBadge.tone(item.kind).color(theme), in: RoundedRectangle(cornerRadius: 3))
      Text(item.label)
        .font(.system(size: 12, design: .monospaced))
        .foregroundStyle(theme.text)
        .lineLimit(1)
      Spacer(minLength: 8)
      if let detail = item.detail {
        Text(detail)
          .font(.system(size: 11))
          .foregroundStyle(theme.textMuted)
          .lineLimit(1)
          .truncationMode(.tail)
      }
    }
    .padding(.horizontal, 8)
    .frame(height: 22)
    .background(selected ? theme.accentSoft : Color.clear)
  }
}

enum CompletionKindBadge {
  static func letter(_ kind: EditorCompletionKind) -> String {
    switch kind {
    case .method, .function, .constructor: "f"
    case .field, .property: "p"
    case .variable, .value: "v"
    case .class, .struct: "C"
    case .interface: "I"
    case .module, .folder, .file: "M"
    case .enum, .enumMember: "E"
    case .keyword: "K"
    case .snippet: "S"
    case .constant: "c"
    case .typeParameter: "T"
    default: "·"
    }
  }

  static func tone(_ kind: EditorCompletionKind) -> Tone {
    switch kind {
    case .method, .function, .constructor: .accent
    case .class, .struct, .interface, .enum, .typeParameter: .success
    case .keyword, .snippet: .warning
    default: .muted
    }
  }
}

/// A borderless child window under the caret. It never becomes key, so typing stays in the editor.
@MainActor final class CompletionPanel {
  private let panel: NSPanel
  private let hosting: NSHostingView<AnyView>
  private let model: CompletionModel

  init(model: CompletionModel) {
    self.model = model
    hosting = NSHostingView(rootView: AnyView(CompletionListView(model: model)))
    panel = NSPanel(
      contentRect: NSRect(x: 0, y: 0, width: 420, height: 200), styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered, defer: true)
    panel.isFloatingPanel = true
    panel.hasShadow = true
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.becomesKeyOnlyIfNeeded = true
    panel.contentView = hosting
    hosting.wantsLayer = true
    hosting.layer?.cornerRadius = 6
    hosting.layer?.masksToBounds = true
  }

  func present(below caret: NSRect, parent: NSWindow, theme: Theme) {
    hosting.rootView = AnyView(
      CompletionListView(model: model)
        .environment(\.theme, theme))
    let size = hosting.fittingSize
    var origin = NSPoint(x: caret.minX - 24, y: caret.minY - size.height - 2)
    if let screen = parent.screen?.visibleFrame, origin.y < screen.minY {
      origin.y = caret.maxY + 2
    }
    panel.setFrame(NSRect(origin: origin, size: size), display: true)
    if panel.parent == nil { parent.addChildWindow(panel, ordered: .above) }
    panel.orderFront(nil)
  }

  func close() {
    panel.parent?.removeChildWindow(panel)
    panel.orderOut(nil)
  }
}
