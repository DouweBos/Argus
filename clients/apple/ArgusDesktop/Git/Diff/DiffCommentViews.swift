import AppKit
import ArgusCore
import ArgusUI
import SwiftUI

/// Sizes of a comment row, measured without laying it out: the table asks for heights first.
@MainActor
enum DiffCommentMetrics {
  static let maxCardWidth: CGFloat = 520
  static let padding: CGFloat = 10
  static var bodyFont: NSFont { .systemFont(ofSize: TextScale.shared(12)) }
  static var headerHeight: CGFloat { TextScale.shared(20).rounded() }

  static func rowHeight(body: String, width: CGFloat) -> CGFloat {
    let text = NSAttributedString(string: body.isEmpty ? " " : body, attributes: [.font: bodyFont])
    let bounds = text.boundingRect(
      with: NSSize(width: width - padding * 2, height: .greatestFiniteMagnitude),
      options: [.usesLineFragmentOrigin, .usesFontLeading])
    return ceil(bounds.height) + headerHeight + padding * 2 + 6 + 12
  }
}

/// A draft comment under its line: who, where, the text, and edit / delete.
struct DiffCommentCard: View {
  @Environment(\.theme) private var theme
  let comment: DiffReviewComment
  let width: CGFloat
  let edit: () -> Void
  let delete: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 6) {
        Image(systemName: "text.bubble").foregroundStyle(theme.accent)
        Text("Draft comment").font(.scaled(size: 11, weight: .semibold))
        Text(comment.lines.count == 1 ? "line \(comment.lines.lowerBound)" : "lines \(comment.lines.lowerBound)–\(comment.lines.upperBound)")
          .font(.scaled(size: 11))
          .foregroundStyle(theme.textMuted)
        Spacer(minLength: 4)
        Button("Edit", action: edit).buttonStyle(.accentLink)
        Button("Delete", action: delete).buttonStyle(.accentLink)
      }
      .frame(height: DiffCommentMetrics.headerHeight)
      Text(comment.body)
        .font(.scaled(size: 12))
        .foregroundStyle(theme.text)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
    }
    .padding(DiffCommentMetrics.padding)
    .frame(width: width, alignment: .topLeading)
    .background(theme.surface, in: .rect(cornerRadius: 8))
    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(theme.accentBorder))
    .padding(.vertical, 6)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

/// Writing or editing a comment, in a popover over its line.
struct DiffCommentComposer: View {
  @Environment(\.theme) private var theme
  let title: String
  let submitTitle: String
  @State var text: String
  let submit: (String) -> Void
  let cancel: () -> Void
  @FocusState private var focused: Bool

  private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title).font(.scaled(size: 12, weight: .semibold)).lineLimit(1).truncationMode(.head)
      TextEditor(text: $text)
        .font(.scaled(size: 12))
        .scrollContentBackground(.hidden)
        .padding(6)
        .background(theme.selection, in: .rect(cornerRadius: 6))
        .frame(height: 96)
        .focused($focused)
      HStack(spacing: 8) {
        Text("⌘↩ to save").font(.scaled(size: 11)).foregroundStyle(theme.textMuted)
        Spacer()
        Button("Cancel", action: cancel)
          .buttonStyle(.secondary)
          .keyboardShortcut(.cancelAction)
        Button(submitTitle) { submit(trimmed) }
          .buttonStyle(AccentButtonStyle())
          .keyboardShortcut(.return, modifiers: .command)
          .disabled(trimmed.isEmpty)
      }
    }
    .padding(12)
    .frame(width: 380)
    .onAppear { focused = true }
  }
}

/// A comment row in the diff table: the SwiftUI card, inset to line up with the code.
final class DiffCommentRowView: NSView {
  static let identifier = NSUserInterfaceItemIdentifier("DiffCommentRowView")
  private var host: NSHostingView<AnyView>?

  convenience init() {
    self.init(frame: .zero)
    identifier = Self.identifier
  }

  func configure(_ card: DiffCommentCard, theme: Theme, inset: CGFloat) {
    let root = AnyView(card.padding(.leading, inset).environment(\.theme, theme))
    if let host {
      host.rootView = root
    } else {
      let host = NSHostingView(rootView: root)
      host.translatesAutoresizingMaskIntoConstraints = false
      addSubview(host)
      NSLayoutConstraint.activate([
        host.leadingAnchor.constraint(equalTo: leadingAnchor),
        host.trailingAnchor.constraint(equalTo: trailingAnchor),
        host.topAnchor.constraint(equalTo: topAnchor),
        host.bottomAnchor.constraint(equalTo: bottomAnchor),
      ])
      self.host = host
    }
  }
}
