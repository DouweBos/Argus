import ArgusCore
import SwiftUI

/// A file's hunks with a row per line, so a tap comments on it; drafts sit under their lines.
/// Lines wrap rather than scroll sideways, which keeps each comment beside what it's about.
public struct ReviewableDiffHunksView: View {
  @Environment(\.theme) private var theme
  let file: DiffFile
  let comments: [DiffReviewComment]
  let onTapLine: (DiffHunk, DiffLine) -> Void
  let onEdit: (DiffReviewComment) -> Void
  let onDelete: (DiffReviewComment) -> Void

  public init(
    file: DiffFile, comments: [DiffReviewComment], onTapLine: @escaping (DiffHunk, DiffLine) -> Void,
    onEdit: @escaping (DiffReviewComment) -> Void, onDelete: @escaping (DiffReviewComment) -> Void
  ) {
    self.file = file
    self.comments = comments
    self.onTapLine = onTapLine
    self.onEdit = onEdit
    self.onDelete = onDelete
  }

  public var body: some View {
    if file.isBinary {
      MutedText("Binary file — nothing to show.")
    } else {
      ForEach(file.hunks) { hunk in
        LazyVStack(alignment: .leading, spacing: 0) {
          Text(hunk.header)
            .font(.scaled(size: 11, design: .monospaced))
            .foregroundStyle(theme.textMuted)
            .padding(.vertical, 4)
            .padding(.horizontal, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.bgTertiary)
          ForEach(hunk.lines) { line in
            row(line)
              .contentShape(Rectangle())
              .onTapGesture { onTapLine(hunk, line) }
              .accessibilityAddTraits(.isButton)
              .accessibilityHint("Comment on this line")
            ForEach(comments.filter { $0.anchors(path: file.displayPath, line: line) }) { comment in
              DiffCommentBubble(comment: comment, onEdit: { onEdit(comment) }, onDelete: { onDelete(comment) })
                .padding(6)
            }
          }
        }
        .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
      }
    }
  }

  private func row(_ line: DiffLine) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 4) {
      Text(number(line))
        .font(.scaled(size: 11, design: .monospaced))
        .foregroundStyle(theme.textMuted)
        .frame(minWidth: 34, alignment: .trailing)
      Text(sign(line) + line.text)
        .font(.scaled(size: 11.5, design: .monospaced))
        .foregroundStyle(color(line))
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.vertical, 1)
    .padding(.trailing, 6)
    .background(background(line))
  }

  private func number(_ line: DiffLine) -> String {
    (line.kind == .remove ? line.oldNumber : line.newNumber).map(String.init) ?? ""
  }

  private func sign(_ line: DiffLine) -> String {
    switch line.kind {
    case .add: "+"
    case .remove: "-"
    case .context: " "
    case .noNewline: "\\"
    }
  }

  private func color(_ line: DiffLine) -> Color {
    switch line.kind {
    case .add: theme.success
    case .remove: theme.error
    case .context: theme.textSecondary
    case .noNewline: theme.textMuted
    }
  }

  private func background(_ line: DiffLine) -> Color {
    switch line.kind {
    case .add: theme.successSoft
    case .remove: theme.errorSoft
    default: .clear
    }
  }
}

/// A draft comment under its line.
public struct DiffCommentBubble: View {
  @Environment(\.theme) private var theme
  let comment: DiffReviewComment
  let onEdit: () -> Void
  let onDelete: () -> Void

  public init(comment: DiffReviewComment, onEdit: @escaping () -> Void, onDelete: @escaping () -> Void) {
    self.comment = comment
    self.onEdit = onEdit
    self.onDelete = onDelete
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 6) {
        Image(systemName: Icon.chat).foregroundStyle(theme.accent)
        Text("Draft comment").font(.scaled(size: 12, weight: .semibold))
        Spacer(minLength: 4)
        Button("Edit", action: onEdit).buttonStyle(.accentLink)
        Button("Delete", role: .destructive, action: onDelete).buttonStyle(.accentLink)
      }
      Text(comment.body)
        .font(.scaled(size: 13))
        .foregroundStyle(theme.text)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(10)
    .background(theme.surface, in: .rect(cornerRadius: theme.radiusSmall))
    .overlay(RoundedRectangle(cornerRadius: theme.radiusSmall).strokeBorder(theme.accentBorder))
  }
}

/// Writing or editing one comment.
public struct DiffCommentSheet: View {
  @Environment(\.theme) private var theme
  @Environment(\.dismiss) private var dismiss
  let title: String
  let submitTitle: String
  @State private var text: String
  @FocusState private var focused: Bool
  let submit: (String) -> Void

  public init(title: String, submitTitle: String, text: String = "", submit: @escaping (String) -> Void) {
    self.title = title
    self.submitTitle = submitTitle
    _text = State(initialValue: text)
    self.submit = submit
  }

  private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

  public var body: some View {
    NavigationStack {
      TextEditor(text: $text)
        .font(.scaled(size: 15))
        .scrollContentBackground(.hidden)
        .padding(12)
        .focused($focused)
        .background(theme.bg)
        .navigationTitle(title)
        #if os(iOS)
          .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
          ToolbarItem(placement: .confirmationAction) {
            Button(submitTitle) {
              submit(trimmed)
              dismiss()
            }
            .disabled(trimmed.isEmpty)
          }
        }
        .onAppear { focused = true }
    }
    .presentationDetents([.medium, .large])
  }
}

/// The session's draft review at the bottom of a diff: how many comments, discard, send.
public struct DiffReviewSendBar: View {
  @Environment(\.theme) private var theme
  let comments: [DiffReviewComment]
  let sending: Bool
  let onDiscard: () -> Void
  let onSend: () -> Void

  public init(comments: [DiffReviewComment], sending: Bool, onDiscard: @escaping () -> Void, onSend: @escaping () -> Void) {
    self.comments = comments
    self.sending = sending
    self.onDiscard = onDiscard
    self.onSend = onSend
  }

  public var body: some View {
    HStack(spacing: 10) {
      VStack(alignment: .leading, spacing: 2) {
        Text(DiffReviewPrompt.plural(comments.count, "comment")).font(.scaled(size: 14, weight: .semibold))
        MutedText("on \(DiffReviewPrompt.plural(Set(comments.map(\.path)).count, "file"))")
      }
      Spacer(minLength: 6)
      Btn(label: "Discard", tone: .ghost, small: true, action: onDiscard).fixedSize()
      Btn(label: "Send to agent", small: true, icon: Icon.send, busy: sending, action: onSend).fixedSize()
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 10)
    .background(.bar)
  }
}

extension View {
  /// The session's draft review pinned under the screen while it has comments; `onSent` gets the agent it went to.
  public func diffReviewBar(sessionId: String, onSent: @escaping (String) -> Void) -> some View {
    modifier(DiffReviewBarModifier(sessionId: sessionId, onSent: onSent))
  }
}

private struct DiffReviewBarModifier: ViewModifier {
  @Environment(HostStore.self) private var host
  let sessionId: String
  let onSent: (String) -> Void
  @State private var sending = false
  @State private var confirmingDiscard = false

  func body(content: Content) -> some View {
    let comments = host.reviews.comments(sessionId)
    content
      .safeAreaInset(edge: .bottom, spacing: 0) {
        if host.hasControl, !comments.isEmpty {
          DiffReviewSendBar(comments: comments, sending: sending, onDiscard: { confirmingDiscard = true }) {
            sending = true
            Task {
              let agentId = await host.sendReview(sessionId: sessionId, defaults: AgentStartDefaults())
              sending = false
              if let agentId { onSent(agentId) }
            }
          }
        }
      }
      .confirmationDialog(
        "Discard \(DiffReviewPrompt.plural(comments.count, "comment"))?", isPresented: $confirmingDiscard,
        titleVisibility: .visible
      ) {
        Button("Discard", role: .destructive) { host.discardReview(sessionId: sessionId) }
      }
  }
}
