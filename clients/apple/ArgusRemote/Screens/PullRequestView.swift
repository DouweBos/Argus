import ArgusUI
import SwiftUI

/// One pull request: what it says, whether CI is happy, what was said about
/// it, and — for a device holding `control` — merge and comment.
struct PullRequestView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(PullRequestsStore.self) private var store

  let repo: String
  let number: Int
  let label: String

  @State private var comment = ""
  @State private var busy = false
  @AppStorage(RemoteMergeStrategy.preferenceKey) private var strategy: RemoteMergeStrategy = .squash
  @State private var confirmingMerge = false

  private var detail: RemotePullRequestDetail? { store.detailById["\(repo)#\(number)"] }

  var body: some View {
    Screen {
      if let error = store.error {
        Banner(text: PullRequestLabels.explain(error), tone: .danger)
      }
      if let detail {
        header(detail)
        if !detail.checks.isEmpty { checks(detail) }
        if !detail.body.isEmpty {
          Card { MarkdownView(text: detail.body, baseSize: 14) }
        }
        conversation(detail)
        if host.hasControl && !detail.merged { actions(detail) }
      } else {
        Loading(label: "Reading the pull request…")
      }
    }
    .navigationTitle(detail?.title ?? label)
    .navigationBarTitleDisplayMode(.inline)
    .alert("Merge this pull request?", isPresented: $confirmingMerge) {
      Button("Cancel", role: .cancel) {}
      Button("Merge") { merge() }
    } message: {
      Text(strategy.label + " on GitHub. This can't be undone from here.")
    }
    .task(id: number) { await store.loadDetail(repo: repo, number: number) }
    .liveRefresh(enabled: host.connection == .ready, every: .seconds(30)) {
      await store.loadDetail(repo: repo, number: number)
    }
  }

  private func header(_ detail: RemotePullRequestDetail) -> some View {
    Card {
      HStack(spacing: 6) {
        MutedText("\(detail.repo) #\(detail.number)", lineLimit: 1)
        Spacer(minLength: 4)
        Badge(label: stateLabel(detail), tone: stateTone(detail))
      }
      MutedText("\(detail.headRef) → \(detail.baseRef)", lineLimit: 1)
      HStack(spacing: 10) {
        if ChangeCounts.hasChanges(additions: Int(detail.additions), deletions: Int(detail.deletions)) {
          Text("+\(detail.additions)").foregroundStyle(theme.success)
          Text("-\(detail.deletions)").foregroundStyle(theme.error)
        }
        MutedText("\(detail.changedFiles) files")
        if let author = detail.author { MutedText("by \(author)") }
      }
      .font(.caption.monospacedDigit())
      if detail.mergeable == "CONFLICTING" {
        Banner(text: "This branch conflicts with its base.", tone: .warning)
      }
    }
  }

  private func checks(_ detail: RemotePullRequestDetail) -> some View {
    Card {
      SectionHeader(title: "Checks", count: detail.checks.count)
      ForEach(detail.checks) { check in
        HStack(spacing: 8) {
          StatusDot(tone: tone(check), pulse: check.tone == .warning)
          BodyText(check.name, lineLimit: 1)
          Spacer(minLength: 4)
          MutedText(check.conclusion ?? check.status ?? "", lineLimit: 1)
        }
      }
    }
  }

  @ViewBuilder
  private func conversation(_ detail: RemotePullRequestDetail) -> some View {
    if !detail.comments.isEmpty {
      SectionHeader(title: "Conversation", count: detail.comments.count)
      ForEach(detail.comments) { entry in
        Card {
          HStack(spacing: 6) {
            BodyText(entry.author ?? "someone")
            if let state = entry.reviewState {
              Badge(label: state.lowercased(), tone: state == "APPROVED" ? .success : .muted)
            }
          }
          MarkdownView(text: entry.body, baseSize: 13)
        }
      }
    }
  }

  private func actions(_ detail: RemotePullRequestDetail) -> some View {
    Card {
      ThemedTextField(placeholder: "Leave a comment", text: $comment, multiline: true)
      Btn(label: busy ? "Working…" : "Comment", tone: .secondary, small: true) { postComment() }
        .disabled(busy || comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

      // A split button, as GitHub's: the remembered strategy, the others behind the chevron.
      HStack(spacing: 8) {
        Btn(label: busy ? "Merging…" : strategy.label, small: true, icon: Icon.merge) { confirmingMerge = true }
        strategyMenu
      }
      .disabled(busy || detail.mergeable == "CONFLICTING")
      if !detail.checksPassing && !detail.checks.isEmpty {
        MutedText("Checks aren't green yet.")
      }
    }
  }

  private var strategyMenu: some View {
    Menu {
      Picker("Merge strategy", selection: $strategy) {
        ForEach(RemoteMergeStrategy.allCases, id: \.self) { Text($0.label).tag($0) }
      }
    } label: {
      Image(systemName: Icon.chevronDown)
        .font(.scaled(size: 12, weight: .semibold))
        .foregroundStyle(theme.text)
        .frame(width: 34, height: 32)
        .overlay(RoundedRectangle(cornerRadius: theme.radiusSmall).stroke(theme.border, lineWidth: 1))
        .contentShape(.rect)
    }
    .accessibilityLabel("Merge strategy")
    .accessibilityValue(strategy.label)
  }

  private func stateLabel(_ detail: RemotePullRequestDetail) -> String {
    if detail.merged { return "merged" }
    if detail.isDraft { return "draft" }

    return detail.state.lowercased()
  }

  private func stateTone(_ detail: RemotePullRequestDetail) -> Tone {
    if detail.merged { return .accent }
    if detail.state == "CLOSED" { return .danger }

    return detail.isDraft ? .muted : .success
  }

  private func tone(_ check: RemotePullRequestCheck) -> Tone {
    switch check.tone {
    case .success: .success
    case .danger: .danger
    case .warning: .warning
    case .muted: .muted
    }
  }

  private func postComment() {
    busy = true
    Task {
      let body = comment.trimmingCharacters(in: .whitespacesAndNewlines)
      if await store.comment(repo: repo, number: number, body: body) {
        comment = ""
      }
      busy = false
    }
  }

  private func merge() {
    busy = true
    Task {
      await store.merge(repo: repo, number: number, strategy: strategy)
      busy = false
    }
  }
}
