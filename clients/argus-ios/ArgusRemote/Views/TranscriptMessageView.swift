import ArgusKit
import SwiftUI

/// One message: its text, its images, its tool calls, and whatever decision it
/// is waiting on.
struct TranscriptMessageView: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app

  let agentKey: String
  let message: RemoteMessage

  private var linked: LinkedProjects.Parsed? {
    guard message.role == .user else { return nil }
    return LinkedProjects.parsePreamble(message.textBlocks.joined(separator: "\n"))
  }

  private var textBlocks: [String] {
    if let linked { return [linked.rest] }
    return message.textBlocks.filter {
      !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
  }

  private var isUser: Bool { message.role == .user }

  var body: some View {
    HStack {
      if isUser { Spacer(minLength: 40) }
      VStack(alignment: isUser ? .trailing : .leading, spacing: 6) {
        badges
        chips
        ForEach(Array(textBlocks.enumerated()), id: \.offset) { _, block in
          MarkdownView(text: block, baseSize: 15)
        }
        images
        ForEach(message.toolCalls) { call in
          ToolCallCard(agentKey: agentKey, call: call, depth: 0)
          if app.isToolCallPending(agentKey: agentKey, call: call) {
            pendingForm(for: call)
          }
        }
        if let timestamp = message.timestamp {
          Text(Date(timeIntervalSince1970: timestamp / 1000).formatted(date: .omitted, time: .shortened))
            .font(.system(size: 10))
            .foregroundStyle(theme.textMuted)
        }
      }
      .padding(message.toolCalls.isEmpty ? 11 : 6)
      .background(isUser ? theme.accentSoft : theme.bgSecondary)
      .clipShape(RoundedRectangle(cornerRadius: theme.radius))
      .overlay(
        RoundedRectangle(cornerRadius: theme.radius)
          .stroke(isUser ? theme.accentBorder : theme.border, lineWidth: 1))
      if !isUser { Spacer(minLength: 24) }
    }
  }

  @ViewBuilder
  private var badges: some View {
    if message.isError == true || message.source != nil || message.author != nil {
      HStack(spacing: 6) {
        if let source = message.source {
          Badge(
            label: source.parentLabel.map { "\($0) → \(source.tool)" }
              ?? "MCP · \(source.tool)")
        }
        if let author = message.author { Badge(label: author) }
        if message.isError == true { Badge(label: "error", tone: .danger) }
      }
    }
  }

  @ViewBuilder
  private var chips: some View {
    if let paths = linked?.paths, !paths.isEmpty {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 6) {
          ForEach(paths, id: \.self) { path in
            Chip(
              label: path.split(separator: "/").last.map(String.init) ?? path,
              icon: Icon.folder)
          }
        }
      }
    }
  }

  @ViewBuilder
  private var images: some View {
    if let refs = message.images, !refs.isEmpty {
      LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 6)], spacing: 6) {
        ForEach(refs, id: \.imageId) { ref in
          TranscriptImage(
            agentKey: agentKey, imageId: ref.imageId,
            siblings: refs.map(\.imageId), maxHeight: 96)
        }
      }
    }
  }

  /// Which form a pending call gets: a question, a plan, or plain allow/deny.
  @ViewBuilder
  private func pendingForm(for call: RemoteToolCall) -> some View {
    if call.name == "AskUserQuestion", let questions = Questions.parse(call.input) {
      QuestionFormView(
        questions: questions,
        onSubmit: { answer in respond(call, "deny", answer) },
        onCancel: { respond(call, "deny", CannedReply.cancelQuestion) })
    } else if call.name == "ExitPlanMode", let plan = call.input["plan"]?.stringValue {
      PlanApprovalView(
        plan: plan,
        onApprove: { respond(call, "allow", nil) },
        onKeepPlanning: { respond(call, "deny", CannedReply.keepPlanning) },
        onFeedback: { feedback in
          respond(call, "deny", CannedReply.planFeedback(feedback))
        })
    } else {
      PermissionButtons(
        onAllow: { respond(call, "allow", nil) },
        onDeny: { respond(call, "deny", nil) })
    }
  }

  private func respond(_ call: RemoteToolCall, _ decision: String, _ message: String?) {
    Task {
      await app.respond(
        agentId: agentKey, toolUseId: call.id, decision: decision, message: message)
    }
  }
}

/// A run of tool-only messages, folded into one row.
struct CollapsedToolGroupView: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app

  let agentKey: String
  let messages: [RemoteMessage]

  @State private var expanded = false

  /// A pending decision inside can never be hidden behind a summary.
  private var forceExpanded: Bool {
    messages.contains { message in
      message.toolCalls.contains { app.isToolCallPending(agentKey: agentKey, call: $0) }
    }
  }

  var body: some View {
    if expanded || forceExpanded {
      VStack(alignment: .leading, spacing: 10) {
        if !forceExpanded {
          summaryButton(expanded: true)
        }
        ForEach(messages) { message in
          TranscriptMessageView(agentKey: agentKey, message: message)
        }
      }
    } else {
      summaryButton(expanded: false)
    }
  }

  private func summaryButton(expanded isExpanded: Bool) -> some View {
    Button {
      expanded.toggle()
    } label: {
      HStack(spacing: 8) {
        Image(systemName: isExpanded ? Icon.chevronDown : Icon.chevronRight)
          .font(.system(size: 10, weight: .semibold))
          .foregroundStyle(theme.textMuted)
        Text(
          "\(ToolGroups.countToolCalls(messages)) tool calls · \(messages.count) messages"
        )
        .font(.system(size: 12))
        .foregroundStyle(theme.textSecondary)
        Spacer(minLength: 4)
        ForEach(ToolGroups.categorize(messages), id: \.0) { category, count in
          if let icon = icon(for: category) {
            HStack(spacing: 2) {
              Image(systemName: icon).font(.system(size: 9))
              Text("\(count)").font(.system(size: 10))
            }
            .foregroundStyle(theme.textMuted)
          }
        }
      }
      .padding(9)
      .background(theme.bgSecondary)
      .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel("Collapsed tool calls")
    .accessibilityValue(isExpanded ? "expanded" : "collapsed")
  }

  private func icon(for category: ToolGroups.ToolCategory) -> String? {
    switch category {
    case .read: Icon.file
    case .search: Icon.search
    case .bash: Icon.terminal
    case .edit: Icon.pencil
    case .web: Icon.web
    case .agent: Icon.agent
    // "other" has no honest glyph; the total already covers it.
    case .other: nil
    }
  }
}
