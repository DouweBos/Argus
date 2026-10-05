import ArgusUI
import SwiftUI

/// Green, red, running or neither — as the phone's `RemotePullRequestCheck.tone`.
func PullRequestCheckTone(_ check: ArgusProtocol.PullRequestCheck) -> Tone {
  switch check.conclusion?.rawValue {
  case "success", "neutral", "skipped": .success
  case "failure", "timed_out", "startup_failure", "action_required": .danger
  case "cancelled", "stale": .muted
  default: check.status == .completed ? .muted : .warning
  }
}

/// The description, every comment and review, and the composer.
struct PullRequestConversation: View {
  @Environment(\.theme) private var theme
  let detail: ArgusProtocol.PullRequestDetail
  let model: PullRequestDetailModel
  @State private var draft = ""
  @State private var confirmingComment = false

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 14) {
        entry(
          author: detail.author, date: detail.createdAt, badge: nil,
          body: detail.body.isEmpty ? "_No description provided._" : detail.body)
        ForEach(detail.comments, id: \.id) { comment in
          entry(
            author: comment.author, date: comment.createdAt, badge: comment.reviewState.flatMap(review),
            body: comment.body, inline: comment.inlineComments ?? [])
        }
        composer
      }
      .padding(16)
      .frame(maxWidth: 820, alignment: .leading)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .confirmationDialog("Post this comment on GitHub?", isPresented: $confirmingComment) {
      Button("Comment") { post() }
    } message: {
      Text("It's posted as you, on \(detail.repoNameWithOwner) #\(Int(detail.number)).")
    }
  }

  private func entry(
    author: String?, date: String, badge: (label: String, tone: Tone)?, body: String,
    inline: [ArgusProtocol.InlineReviewComment] = []
  ) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 6) {
        Text(author ?? "someone").font(.scaled(size: 12, weight: .semibold))
        if let badge { Badge(label: badge.label, tone: badge.tone) }
        Text(PullRequestLabels.relative(date)).font(.scaled(size: 11)).foregroundStyle(.secondary)
      }
      if !body.isEmpty {
        MarkdownView(text: body, baseSize: 13).textSelection(.enabled)
      }
      ForEach(inline, id: \.id) { comment in
        HStack(alignment: .top, spacing: 6) {
          Image(systemName: "text.bubble").foregroundStyle(.secondary)
          Text(comment.body).font(.scaled(size: 12)).lineLimit(4).textSelection(.enabled)
          Spacer()
          Button("View") { model.openOnGitHub(comment.url) }.buttonStyle(.link).controlSize(.small)
        }
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(theme.bgSecondary, in: .rect(cornerRadius: 8))
  }

  private var composer: some View {
    VStack(alignment: .trailing, spacing: 8) {
      TextEditor(text: $draft)
        .font(.scaled(size: 13))
        .frame(minHeight: 80)
        .scrollContentBackground(.hidden)
        .padding(6)
        .background(theme.bgSecondary, in: .rect(cornerRadius: 8))
        .overlay(alignment: .topLeading) {
          if draft.isEmpty {
            Text("Leave a comment").foregroundStyle(.tertiary).padding(.horizontal, 11).padding(.vertical, 6)
              .allowsHitTesting(false)
          }
        }
      Button("Comment") { confirmingComment = true }
        .keyboardShortcut(.return, modifiers: .command)
        .disabled(model.busy != nil || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }
  }

  private func review(_ state: String) -> (label: String, tone: Tone)? {
    switch state {
    case "APPROVED": ("Approved", .success)
    case "CHANGES_REQUESTED": ("Changes requested", .danger)
    case "COMMENTED": ("Reviewed", .muted)
    case "DISMISSED": ("Dismissed", .muted)
    default: (state.lowercased(), .muted)
    }
  }

  private func post() {
    let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    Task { if await model.comment(body) { draft = "" } }
  }
}

struct PullRequestCommits: View {
  let commits: [ArgusProtocol.PullRequestCommit]
  let open: (String) -> Void

  var body: some View {
    if commits.isEmpty {
      ContentUnavailableView("No commits", systemImage: "circle.dashed")
    } else {
      List(commits, id: \.oid) { commit in
        HStack(spacing: 10) {
          Text(commit.abbreviatedOid).font(.scaled(size: 11, design: .monospaced)).foregroundStyle(.secondary)
          VStack(alignment: .leading, spacing: 2) {
            Text(commit.message.components(separatedBy: "\n").first ?? "").lineLimit(1)
            Text("\(commit.author ?? "unknown") · \(PullRequestLabels.relative(commit.committedDate))")
              .font(.scaled(size: 11)).foregroundStyle(.secondary)
          }
          Spacer()
          if let rollup = commit.statusRollup { Badge(label: rollup.lowercased(), tone: tone(rollup)) }
        }
        .contextMenu {
          Button("Open on GitHub") { open(commit.url) }
          Button("Copy SHA") { Clipboard.copy(commit.oid) }
        }
      }
      .listStyle(.inset)
    }
  }

  private func tone(_ rollup: String) -> Tone {
    switch rollup {
    case "SUCCESS": .success
    case "FAILURE", "ERROR": .danger
    case "PENDING", "EXPECTED": .warning
    default: .muted
    }
  }
}

struct PullRequestChecks: View {
  @Environment(\.theme) private var theme
  let checks: [ArgusProtocol.PullRequestCheck]
  let open: (String) -> Void

  var body: some View {
    if checks.isEmpty {
      ContentUnavailableView("No checks", systemImage: "checkmark.seal", description: Text("No CI reported on this pull request."))
    } else {
      List(Array(checks.enumerated()), id: \.offset) { _, check in
        HStack(spacing: 10) {
          Circle().fill(PullRequestCheckTone(check).color(theme)).frame(width: 8, height: 8)
          VStack(alignment: .leading, spacing: 2) {
            Text(check.name).lineLimit(1)
            if let description = check.description, !description.isEmpty {
              Text(description).font(.scaled(size: 11)).foregroundStyle(.secondary).lineLimit(1)
            }
          }
          Spacer()
          Text((check.conclusion?.rawValue ?? check.status?.rawValue ?? "").replacingOccurrences(of: "_", with: " "))
            .font(.scaled(size: 11)).foregroundStyle(.secondary)
          if let url = check.detailsUrl {
            Button("Details") { open(url) }.buttonStyle(.link).controlSize(.small)
          }
        }
      }
      .listStyle(.inset)
    }
  }
}
