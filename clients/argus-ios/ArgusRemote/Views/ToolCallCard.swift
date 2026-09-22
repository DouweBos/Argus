import ArgusKit
import SwiftUI

/// One tool call, collapsed to a single line until you ask for more.
///
/// A call awaiting a permission decision can never be collapsed away — the
/// decision is the whole point of the row.
struct ToolCallCard: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app

  let agentKey: String
  let call: RemoteToolCall
  let depth: Int

  @State private var userExpanded = false

  private var isPending: Bool {
    app.isToolCallPending(agentKey: agentKey, call: call)
  }

  private var expanded: Bool { isPending || userExpanded }

  private var borderColor: Color {
    if isPending { return theme.warning.opacity(0.6) }
    if call.isError == true || call.status == .error { return theme.error.opacity(0.6) }
    return theme.borderSubtle
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      header
      if expanded {
        expandedBody
      } else {
        collapsedPreview
      }
    }
    .padding(9)
    .background(theme.bgTertiary.opacity(depth > 0 ? 0.6 : 1))
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
    .overlay(
      RoundedRectangle(cornerRadius: theme.radiusSmall).stroke(borderColor, lineWidth: 1))
  }

  private var displayName: String {
    if call.name == "Agent", let type = call.input["subagent_type"]?.stringValue {
      return type
    }
    return call.name
  }

  private var header: some View {
    Button {
      guard !isPending else { return }
      userExpanded.toggle()
    } label: {
      HStack(spacing: 6) {
        if call.status == .running && (call.name == "Agent" || call.name == "Task") {
          ProgressView().controlSize(.mini)
        } else {
          Image(systemName: expanded ? Icon.chevronDown : Icon.chevronRight)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(theme.textMuted)
        }
        Text(displayName)
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(theme.text)
        MonoText(
          text: ToolCallSummary.summary(name: call.name, input: call.input),
          size: 11, lineLimit: 1,
          truncateHead: ToolCallSummary.isPathTool(call.name))
        Spacer(minLength: 4)
        editStats
        if isPending { Badge(label: "needs approval", tone: .warning) }
        if call.isError == true { Badge(label: "error", tone: .danger) }
        if call.status == .running && !isPending { Badge(label: "running", tone: .accent) }
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  @ViewBuilder
  private var editStats: some View {
    if let stats = editDiffStats {
      HStack(spacing: 4) {
        if stats.additions > 0 {
          Text("+\(stats.additions)")
            .font(.system(size: 10, design: .monospaced))
            .foregroundStyle(theme.success)
        }
        if stats.deletions > 0 {
          Text("-\(stats.deletions)")
            .font(.system(size: 10, design: .monospaced))
            .foregroundStyle(theme.error)
        }
      }
    }
  }

  private var editDiffStats: InlineDiff.Stats? {
    switch call.name {
    case "Edit":
      guard let old = call.input["old_string"]?.stringValue,
        let new = call.input["new_string"]?.stringValue
      else { return nil }
      return InlineDiff.stats(old: old, new: new)
    case "Write":
      guard let content = call.input["content"]?.stringValue else { return nil }
      return InlineDiff.writeStats(content)
    default:
      return nil
    }
  }

  /// Even collapsed, an edit shows what it changed — that is the one thing
  /// worth seeing without opening it.
  @ViewBuilder
  private var collapsedPreview: some View {
    if let lines = inlineDiffLines {
      DiffLinesView(lines: lines)
    }
  }

  private var inlineDiffLines: [DiffLine]? {
    switch call.name {
    case "Edit":
      guard let old = call.input["old_string"]?.stringValue,
        let new = call.input["new_string"]?.stringValue
      else { return nil }
      return InlineDiff.compute(old: old, new: new)
    case "Write":
      guard let content = call.input["content"]?.stringValue else { return nil }
      return InlineDiff.writeLines(content)
    default:
      return nil
    }
  }

  /// The form below a pending call already shows its questions or its plan, so
  /// the card would otherwise print the same thing — as raw JSON — above it.
  private var formOwnsInput: Bool {
    isPending && PendingForm.of(name: call.name, input: call.input).ownsInput
  }

  /// The answer text an AskUserQuestion came back with, once it has one.
  private var answeredQuestions: (questions: [Questions.Question], answer: String)? {
    guard call.name == "AskUserQuestion", !isPending,
      let questions = Questions.parse(call.input)
    else { return nil }
    let answer = call.resultBlocks.compactMap { block -> String? in
      if case .text(let text) = block { return text }
      return nil
    }.joined(separator: "\n")
    return answer.isEmpty ? nil : (questions, answer)
  }

  @ViewBuilder
  private var expandedBody: some View {
    if !formOwnsInput {
      inputBody
    }

    // The answer view already shows what came back; the raw text is the same
    // thing again, one formatting layer down.
    if !call.resultBlocks.isEmpty && answeredQuestions == nil {
      resultBlocks
    }

    if let children = call.children, !children.isEmpty, depth < 3 {
      Text("Sub-agent activity")
        .font(.system(size: 10, weight: .bold))
        .foregroundStyle(theme.textMuted)
      ForEach(Array(children.enumerated()), id: \.offset) { _, child in
        switch child {
        case .text(let text):
          MutedText(text)
        case .toolUse(let nested):
          ToolCallCard(agentKey: agentKey, call: nested, depth: depth + 1)
        }
      }
    }
  }

  /// What the call was asked to do. Every shape gets a view — nothing here
  /// ever falls back to printing the input as JSON.
  @ViewBuilder
  private var inputBody: some View {
    if let lines = inlineDiffLines {
      DiffLinesView(lines: lines)
    } else if call.name == "ExitPlanMode", let plan = call.input["plan"]?.stringValue {
      MarkdownView(text: plan, baseSize: 13)
    } else if let answered = answeredQuestions {
      AnsweredQuestionsView(questions: answered.questions, answer: answered.answer)
    } else if call.name == "Bash", let command = call.input["command"]?.stringValue {
      MonoText(text: command, size: 11)
    } else {
      ToolInputFieldsView(fields: ToolInput.fields(call.input))
    }
  }

  private static let resultPreviewChars = 500

  /// Every image in this result, so the viewer can page across them.
  private var resultImageIds: [String] {
    call.resultBlocks.compactMap { block in
      if case .image(let imageId, _) = block { return imageId }
      return nil
    }
  }

  @ViewBuilder
  private var resultBlocks: some View {
    ForEach(Array(call.resultBlocks.enumerated()), id: \.offset) { _, block in
      switch block {
      case .text(let text):
        let clipped =
          text.count > Self.resultPreviewChars
          ? String(text.prefix(Self.resultPreviewChars)) + "…" : text
        Text(clipped)
          .font(.system(size: 11, design: .monospaced))
          .foregroundStyle(call.isError == true ? theme.error : theme.textSecondary)
      case .image(let imageId, _):
        TranscriptImage(
          agentKey: agentKey, imageId: imageId, siblings: resultImageIds, maxHeight: 220)
      }
    }
  }
}

/// A transcript image, fetched lazily by id and cached in the store.
///
/// `siblings` is the set this image belongs to — the other attachments on the
/// same message, or the other blocks in the same tool result — so opening one
/// gives you a pager over all of them rather than a dead end.
struct TranscriptImage: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(ImageViewerState.self) private var viewer

  let agentKey: String
  let imageId: String
  var siblings: [String]?
  var maxHeight: CGFloat = 220

  private var group: [String] { siblings ?? [imageId] }

  private var dataURI: String? { app.cachedImage(agentId: agentKey, imageId: imageId) }

  var body: some View {
    Group {
      if let image = dataURI.flatMap(UIImage.fromDataURI) {
        Image(uiImage: image)
          .resizable()
          .scaledToFit()
          .frame(maxHeight: maxHeight)
          .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
          .onTapGesture {
            viewer.present(
              agentKey: agentKey, imageIds: group,
              at: group.firstIndex(of: imageId) ?? 0)
          }
      } else {
        RoundedRectangle(cornerRadius: theme.radiusSmall)
          .fill(theme.bgHover)
          .frame(height: 80)
          .overlay(ProgressView().controlSize(.small))
      }
    }
    .task(id: imageId) {
      await app.loadImage(agentId: agentKey, imageId: imageId)
    }
  }
}

extension UIImage {
  /// Transcript images arrive as `data:<mime>;base64,…`.
  static func fromDataURI(_ uri: String) -> UIImage? {
    guard let comma = uri.firstIndex(of: ","),
      let data = Data(base64Encoded: String(uri[uri.index(after: comma)...]))
    else { return nil }
    return UIImage(data: data)
  }
}
