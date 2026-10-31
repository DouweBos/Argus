import ArgusCore
import SwiftUI

/// One message: its text, its images, its tool calls, and whatever decision it
/// is waiting on.
public struct TranscriptMessageView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host

  let agentKey: String
  let message: RemoteMessage

  private var linked: LinkedProjects.Parsed? {
    guard message.role == .user else { return nil }
    return LinkedProjects.parsePreamble(message.textBlocks.joined(separator: "\n"))
  }

  private var textBlocks: [String] { message.displayBlocks }

  private var isUser: Bool { message.role == .user }

  public init(agentKey: String, message: RemoteMessage) {
    self.agentKey = agentKey
    self.message = message
  }

  public var body: some View {
    HStack {
      if isUser { Spacer(minLength: 40) }
      VStack(alignment: isUser ? .trailing : .leading, spacing: 6) {
        badges
        chips
        // Attachments sit beside the bubble, not inside it: an image in the
        // background makes the bubble stretch to the image's width and reads
        // as part of the message body rather than something sent with it.
        images
        if hasBubbleContent { bubble }
        if HostStore.isOptimistic(id: message.id) {
          SendingLabel()
        } else if let timestamp = message.timestamp {
          Text(
            Date(timeIntervalSince1970: timestamp / 1000)
              .formatted(date: .omitted, time: .shortened)
          )
          .font(.scaled(.caption2))
          .foregroundStyle(.tertiary)
        }
      }
      if !isUser { Spacer(minLength: 24) }
    }
  }

  private var hasBubbleContent: Bool {
    !textBlocks.isEmpty || !message.toolCalls.isEmpty
  }

  private var bubble: some View {
    VStack(alignment: isUser ? .trailing : .leading, spacing: 6) {
      ForEach(Array(textBlocks.enumerated()), id: \.offset) { _, block in
        MarkdownView(text: block, baseSize: 15)
      }
      ForEach(message.toolCalls) { call in
        ToolCallCard(agentKey: agentKey, call: call, depth: 0)
        if host.isToolCallPending(agentKey: agentKey, call: call) {
          PendingCallForm(agentKey: agentKey, call: call)
        }
      }
    }
    .padding(message.toolCalls.isEmpty ? 11 : 6)
    .background(isUser ? theme.accentSoft : theme.bgSecondary)
    .clipShape(RoundedRectangle(cornerRadius: theme.radius))
    .overlay(
      RoundedRectangle(cornerRadius: theme.radius)
        .stroke(isUser ? theme.accentBorder : theme.border, lineWidth: 1))
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
      // The scroll view takes the full width, so without an anchor the chips
      // hug the leading edge even above a trailing user bubble.
      .defaultScrollAnchor(isUser ? .trailing : .leading)
      .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
    }
  }

  @ViewBuilder
  private var images: some View {
    if let refs = message.images, !refs.isEmpty {
      HStack(alignment: .top, spacing: 6) {
        ForEach(refs.prefix(3), id: \.imageId) { ref in
          TranscriptImage(
            agentKey: agentKey, imageId: ref.imageId,
            siblings: refs.map(\.imageId), maxHeight: 140)
        }
      }
      if refs.count > 3 {
        Text("+\(refs.count - 3) more")
          .font(.scaled(.caption))
          .foregroundStyle(.secondary)
      }
    }
  }
}

/// The decision a pending call is waiting on. Shared by top-level calls and
/// sub-agent calls, which need an answer just the same.
struct PendingCallForm: View {
  @Environment(HostStore.self) private var host

  let agentKey: String
  let call: RemoteToolCall

  var body: some View { form(for: call) }

  /// The repo behind this agent, for seeding a sibling session from a plan.
  private var planRepoRoot: String? {
    guard let sessionId = host.statusByAgent[agentKey]?.sessionId else { return nil }

    return host.repoRoot(forSessionId: sessionId)
  }

  /// Which form a pending call gets: a question, a plan, or plain allow/deny.
  @ViewBuilder
  private func form(for call: RemoteToolCall) -> some View {
    switch PendingForm.of(name: call.name, input: call.input) {
    case .question(let questions):
      QuestionFormView(
        questions: questions,
        onSubmit: { answer in respond(call, "deny", answer) },
        onCancel: { respond(call, "deny", CannedReply.cancelQuestion) })
    case .plan(let plan):
      PlanApprovalView(
        plan: plan,
        onApprove: {
          host.noteLeftPlanMode(agentId: agentKey)
          respond(call, "allow", nil)
        },
        onKeepPlanning: { respond(call, "deny", CannedReply.keepPlanning) },
        onFeedback: { feedback in
          respond(call, "deny", CannedReply.planFeedback(feedback))
        },
        // No repo, nowhere to put the session — same rule as the desktop.
        onApproveInNewSession: planRepoRoot.map { repoRoot in
          {
            Task { await host.handOffPlan(repoRoot: repoRoot, plan: plan) }
            respond(call, "deny", CannedReply.planHandoff)
          }
        })
    case .buttons:
      PermissionButtons(
        onAllow: { respond(call, "allow", nil) },
        onDeny: { respond(call, "deny", nil) })
    }
  }

  private func respond(_ call: RemoteToolCall, _ decision: String, _ message: String?) {
    Task {
      await host.respond(
        agentId: agentKey, toolUseId: call.id, decision: decision, message: message)
    }
  }
}

/// Stands in for the timestamp until the computer has the message.
struct SendingLabel: View {
  var body: some View {
    HStack(spacing: 4) {
      ProgressView().controlSize(.mini)
      Text("Sending…")
    }
    .font(.scaled(.caption2))
    .foregroundStyle(.tertiary)
    .accessibilityElement(children: .combine)
  }
}

/// A run of tool-only messages, folded into one row.
public struct CollapsedToolGroupView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host

  let agentKey: String
  let messages: [RemoteMessage]

  @State private var expanded = false

  /// A pending decision inside can never be hidden behind a summary.
  private var forceExpanded: Bool {
    messages.contains { message in
      message.toolCalls.contains { host.hasPendingCall(agentKey: agentKey, in: $0) }
    }
  }

  public init(agentKey: String, messages: [RemoteMessage]) {
    self.agentKey = agentKey
    self.messages = messages
  }

  public var body: some View {
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
          .font(.scaled(size: 10, weight: .semibold))
          .foregroundStyle(theme.textMuted)
        Text(
          "\(ToolGroups.countToolCalls(messages)) tool calls · \(messages.count) messages"
        )
        .font(.scaled(size: 12))
        .foregroundStyle(theme.textSecondary)
        Spacer(minLength: 4)
        ForEach(ToolGroups.categorize(messages), id: \.0) { category, count in
          if let icon = icon(for: category) {
            HStack(spacing: 2) {
              Image(systemName: icon).font(.scaled(size: 9))
              Text("\(count)").font(.scaled(size: 10))
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
    .buttonStyle(.argusPlain)
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
