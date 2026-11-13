import ArgusCore
import SwiftUI

/// One stop on a review guide: why it matters, what to judge, the hunks it points at
/// (tap a line to comment), and questions about it. The caller scrolls it.
public struct ReviewGuideStopView: View {
  @Environment(HostStore.self) private var host
  @Environment(\.theme) private var theme
  let target: ReviewGuideTarget
  let stop: ReviewGuideStop
  let index: Int
  let total: Int
  let onPrevious: (() -> Void)?
  let onNext: (() -> Void)?
  /// Opens a file at a line, where the platform has a code view for the target.
  let openLine: ((String, Int) -> Void)?
  @State private var composing: Composing?
  @State private var question = ""

  private struct Composing: Identifiable {
    let comment: DiffReviewComment
    let isNew: Bool
    var id: UUID { comment.id }
  }

  public init(
    target: ReviewGuideTarget, stop: ReviewGuideStop, index: Int, total: Int, onPrevious: (() -> Void)?,
    onNext: (() -> Void)?, openLine: ((String, Int) -> Void)? = nil
  ) {
    self.target = target
    self.stop = stop
    self.index = index
    self.total = total
    self.onPrevious = onPrevious
    self.onNext = onNext
    self.openLine = openLine
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      VStack(alignment: .leading, spacing: 6) {
        HStack(spacing: 6) {
          MutedText("Stop \(index + 1) of \(total)")
          if stop.mechanical { Badge(label: "Mechanical", tone: .muted) }
        }
        Text(stop.title).font(.scaled(.title3).weight(.semibold)).foregroundStyle(theme.text).textSelection(.enabled)
        if !stop.summary.isEmpty {
          MarkdownView(text: stop.summary, baseSize: 13).textSelection(.enabled)
        }
      }
      if !stop.lookClosely.isEmpty { lookClosely }
      ForEach(host.reviewGuides.files(target, stop: stop)) { file in
        fileSection(file)
      }
      ask
      navigation
    }
    .onAppear { host.markStopVisited(target, stop: stop.id) }
    .onChange(of: stop.id) { _, id in host.markStopVisited(target, stop: id) }
    .sheet(item: $composing) { composing in
      DiffCommentSheet(
        title: composing.isNew ? "Line \(composing.comment.lines.lowerBound)" : "Edit comment",
        submitTitle: composing.isNew ? "Add" : "Save", text: composing.comment.body
      ) { body in
        if composing.isNew {
          var comment = composing.comment
          comment.body = body
          host.addReviewComment(comment, sessionId: target.key)
        } else {
          host.reviews.update(composing.comment.id, body: body, sessionId: target.key)
        }
      }
    }
  }

  private var lookClosely: some View {
    VStack(alignment: .leading, spacing: 8) {
      Label("Look closely", systemImage: Icon.eye)
        .font(.scaled(size: 12, weight: .semibold))
        .foregroundStyle(theme.warning)
      ForEach(Array(stop.lookClosely.enumerated()), id: \.offset) { _, flag in
        VStack(alignment: .leading, spacing: 3) {
          Text(flag.note).font(.scaled(size: 13)).foregroundStyle(theme.text).textSelection(.enabled)
          if let path = flag.path {
            let location = flag.line.map { "\(path):\(Int($0))" } ?? path
            if let openLine, let line = flag.line {
              Button(location) { openLine(path, Int(line)) }
                .buttonStyle(.argusPlain)
                .font(.scaled(size: 11, design: .monospaced))
                .foregroundStyle(theme.accent)
            } else {
              MonoText(text: location, size: 11, color: theme.textMuted, lineLimit: 1, truncateHead: true)
            }
          }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.warning.opacity(0.08), in: .rect(cornerRadius: theme.radiusSmall))
      }
    }
  }

  private func fileSection(_ file: DiffFile) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 6) {
        FileTypeIcon(path: file.displayPath, size: 13)
        MonoText(text: file.displayPath, size: 12, color: theme.text, lineLimit: 1, truncateHead: true)
        Spacer(minLength: 6)
        ChangeCounts(additions: file.additions, deletions: file.deletions)
      }
      if host.hasControl {
        ReviewableDiffHunksView(
          file: file, comments: host.reviews.comments(target.key, path: file.displayPath),
          onTapLine: { hunk, line in
            if let draft = DiffReviewComment.draft(path: file.displayPath, hunk: hunk, line: line, scope: target.scope) {
              composing = Composing(comment: draft, isNew: true)
            }
          },
          onEdit: { composing = Composing(comment: $0, isNew: false) },
          onDelete: { host.deleteReviewComment($0.id, sessionId: target.key) })
      } else {
        DiffHunksView(file: file, collapsesLongHunks: true)
      }
    }
  }

  private var ask: some View {
    let answers = host.reviewGuides.answers(target, stop: stop.id)
    let asking = host.reviewGuides.isAsking(target, stop: stop.id)
    return VStack(alignment: .leading, spacing: 8) {
      Label("Ask about this stop", systemImage: Icon.sideQuestion)
        .font(.scaled(size: 12, weight: .semibold))
        .foregroundStyle(theme.textMuted)
      ForEach(answers) { answer in
        VStack(alignment: .leading, spacing: 6) {
          Text(answer.question).font(.scaled(size: 13, weight: .medium)).foregroundStyle(theme.text)
          MarkdownView(text: answer.answer, baseSize: 13).textSelection(.enabled)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.bgSecondary, in: .rect(cornerRadius: theme.radiusSmall))
      }
      if host.hasControl {
        HStack(spacing: 8) {
          TextField("Why is this needed? What happens if…", text: $question, axis: .vertical)
            .textFieldStyle(.plain)
            .font(.scaled(size: 13))
            .lineLimit(1...4)
            .padding(8)
            .background(theme.bgSecondary, in: .rect(cornerRadius: theme.radiusSmall))
            .onSubmit(send)
            .disabled(asking)
          Btn(label: "Ask", tone: .secondary, small: true, busy: asking, action: send)
            .fixedSize()
            .disabled(asking || question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
      }
    }
  }

  private var navigation: some View {
    HStack {
      if let onPrevious {
        Btn(label: "Previous", tone: .ghost, small: true, icon: Icon.chevronLeft, action: onPrevious).fixedSize()
      }
      Spacer()
      if let onNext {
        Btn(label: "Next Stop", small: true, icon: Icon.chevronRight, action: onNext).fixedSize()
      }
    }
  }

  private func send() {
    let text = question.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    question = ""
    Task { await host.askAboutStop(target, stop: stop.id, question: text) }
  }
}
