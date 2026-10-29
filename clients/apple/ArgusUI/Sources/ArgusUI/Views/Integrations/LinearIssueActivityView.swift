import ArgusCore
import ArgusKit
import SwiftUI

/// Linear's Activity: history as one-liners, long runs folded away, comment
/// threads as cards with their replies and a reply box, a comment box last.
struct LinearIssueActivityView: View {
  @Environment(\.theme) private var theme
  let model: LinearIssueDetailModel
  let issue: HostStore.LinearIssueDetail
  let canComment: Bool
  @State private var unfolded: Set<String> = []
  @State private var draft = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      header
      ForEach(LinearIssueActivity.timeline(history: issue.history ?? [], comments: issue.comments)) { item in
        switch item {
        case .event(let event):
          LinearHistoryLine(event: event)
        case .folded(let events):
          if unfolded.contains(item.id) {
            ForEach(events, id: \.id) { LinearHistoryLine(event: $0) }
          } else {
            foldedLine(item.id, events)
          }
        case .thread(let thread):
          LinearThreadCard(model: model, thread: thread, canReply: canComment)
        }
      }
      if canComment { composer }
    }
  }

  private var header: some View {
    HStack(spacing: 8) {
      Text("Activity").font(.scaled(size: 15, weight: .semibold)).foregroundStyle(theme.text)
      Spacer(minLength: 0)
      if let subscribers = issue.subscribers, !subscribers.isEmpty {
        HStack(spacing: -5) {
          ForEach(Array(subscribers.prefix(5).enumerated()), id: \.offset) { _, person in
            LinearAvatar(name: person.name, url: person.avatarUrl, size: 20)
              .overlay(Circle().stroke(theme.bg, lineWidth: 1.5))
          }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Subscribers: " + subscribers.map(\.name).joined(separator: ", "))
        .help(subscribers.map(\.name).joined(separator: ", "))
      }
    }
    .padding(.bottom, 2)
  }

  private func foldedLine(_ id: String, _ events: [ArgusProtocol.LinearHistoryEvent]) -> some View {
    Button {
      unfolded.insert(id)
    } label: {
      HStack(spacing: 10) {
        Image(systemName: "chevron.up.chevron.down")
          .font(.scaled(size: 10, weight: .semibold))
          .frame(width: 18)
        Text(LinearIssueActivity.foldedSummary(events) + "…").font(.scaled(size: 12)).lineLimit(1)
        Spacer(minLength: 0)
      }
      .foregroundStyle(theme.textMuted)
      .contentShape(Rectangle())
    }
    .buttonStyle(.argusPlain)
  }

  private var composer: some View {
    LinearCommentComposer(
      placeholder: "Leave a comment…", text: $draft, posting: model.posting && model.postingIn == nil,
      lines: 2...8
    ) {
      Task { if await model.comment(draft) { draft = "" } }
    }
    .padding(.top, 6)
  }
}

/// "ann set priority to High · 5w ago", with an icon for what changed.
struct LinearHistoryLine: View {
  @Environment(\.theme) private var theme
  let event: ArgusProtocol.LinearHistoryEvent

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      Group {
        if let actor = event.actor, event.kind == .created {
          LinearAvatar(name: actor, url: event.actorAvatarUrl, size: 16)
        } else {
          Image(systemName: Self.icon(event.kind)).font(.scaled(size: 11)).foregroundStyle(theme.textMuted)
        }
      }
      .frame(width: 18)
      let actor = Text(event.actor ?? "Linear").foregroundStyle(theme.textSecondary).fontWeight(.medium)
      Text("\(actor) \(event.text) · \(Labels.timeAgo(event.createdAt))")
        .foregroundStyle(theme.textMuted)
        .font(.scaled(size: 12))
        .lineLimit(2)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(LinearIssueActivity.sentence(event)), \(Labels.timeAgo(event.createdAt))")
  }

  static func icon(_ kind: ArgusProtocol.LinearHistoryEventKind) -> String {
    switch kind {
    case .status: "circle.dashed"
    case .priority: "chart.bar.fill"
    case .assignee: Icon.person
    case .estimate: "triangle"
    case .cycle: "arrow.triangle.2.circlepath"
    case .project: "cube"
    case .labels: "tag"
    case .title, .description: Icon.pencil
    case .due: "calendar"
    case .parent: "arrow.turn.left.up"
    case .relation: "square.on.square"
    case .attachment: Icon.link
    case .created: "plus.circle"
    default: "circle.fill"
    }
  }
}

/// A thread as a card: its first comment, the replies under it, and a reply box.
struct LinearThreadCard: View {
  @Environment(\.theme) private var theme
  let model: LinearIssueDetailModel
  let thread: LinearIssueActivity.Thread
  let canReply: Bool
  @State private var reply = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      LinearCommentBody(comment: thread.root)
      ForEach(Array(thread.replies.enumerated()), id: \.offset) { _, comment in
        Divider().overlay(theme.borderSubtle)
        LinearCommentBody(comment: comment)
      }
      if canReply, let target = thread.replyTarget {
        Divider().overlay(theme.borderSubtle)
        LinearCommentComposer(
          placeholder: "Leave a reply…", text: $reply,
          posting: model.posting && model.postingIn == target, lines: 1...6, inline: true
        ) {
          Task { if await model.comment(reply, parentId: target) { reply = "" } }
        }
        .padding(8)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(theme.bgSecondary)
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
    .overlay(RoundedRectangle(cornerRadius: theme.radiusSmall).stroke(theme.borderSubtle, lineWidth: 1))
  }
}

/// Avatar, name and time, the comment, and its reactions.
struct LinearCommentBody: View {
  @Environment(\.theme) private var theme
  let comment: ArgusProtocol.LinearComment

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        LinearAvatar(name: comment.author ?? "Someone", url: comment.authorAvatarUrl, size: 18)
        Text(comment.author ?? "Someone").font(.scaled(size: 12, weight: .semibold)).foregroundStyle(theme.text)
        Text(Labels.timeAgo(comment.createdAt)).font(.scaled(size: 12)).foregroundStyle(theme.textMuted)
      }
      MarkdownView(text: comment.body, baseSize: 14)
      if let reactions = comment.reactions, !reactions.isEmpty {
        HStack(spacing: 6) {
          ForEach(reactions, id: \.emoji) { reaction in
            Text("\(reaction.emoji) \(Int(reaction.count))")
              .font(.scaled(size: 12))
              .foregroundStyle(theme.textSecondary)
              .padding(.horizontal, 7)
              .padding(.vertical, 2)
              .overlay(Capsule().stroke(theme.border, lineWidth: 1))
              .accessibilityLabel("\(reaction.emoji), \(Int(reaction.count))")
          }
        }
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// A text box with a send button, posting as the computer's Linear user.
struct LinearCommentComposer: View {
  @Environment(\.theme) private var theme
  let placeholder: String
  @Binding var text: String
  let posting: Bool
  var lines: ClosedRange<Int> = 2...8
  /// Inside a thread card: no box of its own.
  var inline = false
  let onSend: () -> Void

  private var empty: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

  var body: some View {
    HStack(alignment: .bottom, spacing: 8) {
      ThemedTextField(placeholder: placeholder, text: $text, multiline: true, lines: lines)
      Button(action: onSend) {
        Group {
          if posting {
            ProgressView().controlSize(.small)
          } else {
            Image(systemName: Icon.send).font(.scaled(size: 22)).foregroundStyle(empty ? theme.textMuted : theme.accent)
          }
        }
        .frame(width: 30, height: 30)
        .contentShape(Rectangle())
      }
      .buttonStyle(.argusPlain)
      .disabled(posting || empty)
      .keyboardShortcut(inline ? nil : KeyboardShortcut(.return, modifiers: .command))
      .accessibilityLabel(inline ? "Reply" : "Comment")
      .help(inline ? "Reply" : "Comment (⌘↩)")
    }
  }
}
