import ArgusUI
import SwiftUI

/// One message: badges, attachments, its text as one selectable TextKit view,
/// and its tool calls. A call waiting on a decision is drawn in the prompt
/// area at the bottom instead, so it never shows twice.
struct TranscriptMessageRow: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(TranscriptModel.self) private var model

  let agentKey: String
  let message: RemoteMessage

  private var isUser: Bool { message.role == .user }

  private var calls: [RemoteToolCall] {
    message.toolCalls.filter { !host.isToolCallPending(agentKey: agentKey, call: $0) }
  }

  var body: some View {
    HStack(alignment: .top, spacing: 0) {
      if isUser { Spacer(minLength: 80) }
      VStack(alignment: isUser ? .trailing : .leading, spacing: 6) {
        badges
        chips
        images
        if let text = model.text(for: message) {
          textView(text)
        }
        ForEach(calls) { call in
          TranscriptToolCall(agentKey: agentKey, messageId: message.id, call: call)
        }
      }
      if !isUser { Spacer(minLength: 0) }
    }
    .help(timestamp)
  }

  private func textView(_ text: NSAttributedString) -> some View {
    let unit = TranscriptModel.textUnit(message.id)
    let current = model.currentHit.flatMap { $0.unitId == unit ? $0.range : nil }
    return TranscriptText(
      text: text, highlights: model.hitsByUnit[unit] ?? [], current: current,
      revealToken: current == nil ? 0 : model.revealToken, fills: !isUser
    )
    .padding(.horizontal, isUser ? 12 : 0)
    .padding(.vertical, isUser ? 8 : 0)
    .background {
      if isUser {
        RoundedRectangle(cornerRadius: theme.radius)
          .fill(theme.accentSoft)
          .overlay(RoundedRectangle(cornerRadius: theme.radius).stroke(theme.accentBorder, lineWidth: 1))
      }
    }
  }

  private var timestamp: String {
    guard let timestamp = message.timestamp else { return "" }
    return Date(timeIntervalSince1970: timestamp / 1000).formatted(date: .abbreviated, time: .shortened)
  }

  @ViewBuilder
  private var badges: some View {
    if message.isError == true || message.source != nil || message.author != nil {
      HStack(spacing: 6) {
        if let source = message.source {
          Badge(label: source.parentLabel.map { "\($0) → \(source.tool)" } ?? "MCP · \(source.tool)")
        }
        if let author = message.author { Badge(label: author) }
        if message.isError == true { Badge(label: "error", tone: .danger) }
      }
    }
  }

  @ViewBuilder
  private var chips: some View {
    if isUser,
      let paths = LinkedProjects.parsePreamble(message.textBlocks.joined(separator: "\n"))?.paths,
      !paths.isEmpty
    {
      HStack(spacing: 6) {
        ForEach(paths, id: \.self) { path in
          Chip(label: (path as NSString).lastPathComponent, icon: Icon.folder)
            .help(path)
        }
      }
    }
  }

  @ViewBuilder
  private var images: some View {
    if let refs = message.images, !refs.isEmpty {
      HStack(alignment: .top, spacing: 6) {
        ForEach(refs, id: \.imageId) { ref in
          TranscriptImage(
            agentKey: agentKey, imageId: ref.imageId, siblings: refs.map(\.imageId), maxHeight: 160)
        }
      }
    }
  }
}

/// A tool call, outlined while find has a match in its summary.
struct TranscriptToolCall: View {
  @Environment(\.theme) private var theme
  @Environment(TranscriptModel.self) private var model
  @Environment(\.transcriptLinks) private var links

  let agentKey: String
  let messageId: String
  let call: RemoteToolCall

  private var unit: String { TranscriptModel.toolUnit(messageId, call.id) }

  private var path: String? {
    guard ToolCallSummary.isPathTool(call.name) else { return nil }
    return call.input["file_path"]?.stringValue ?? call.input["path"]?.stringValue
  }

  var body: some View {
    let isCurrent = model.currentHit?.unitId == unit
    let isHit = model.hitsByUnit[unit] != nil
    ToolCallCard(agentKey: agentKey, call: call, depth: 0)
      .overlay {
        if isHit {
          RoundedRectangle(cornerRadius: theme.radiusSmall)
            .stroke(isCurrent ? theme.accent : theme.accentBorder, lineWidth: isCurrent ? 2 : 1)
        }
      }
      .contextMenu {
        if let path, let links {
          let ref = FileLinks.parseFileRef(path)
          Button("Open \((path as NSString).lastPathComponent)") { links.openFile(ref) }
          Button("Reveal in Finder") { links.reveal(ref) }
          Button("Copy Path") { links.copyPath(ref) }
        }
      }
  }
}

/// A run of tool-only messages folded into one row. Open state lives in the
/// model so find can open a group that holds the match.
struct TranscriptToolGroup: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(TranscriptModel.self) private var model

  let agentKey: String
  let id: String
  let messages: [RemoteMessage]

  private var expanded: Bool { model.expandedGroups.contains(id) }

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      summary
      if expanded {
        ForEach(messages) { message in
          TranscriptMessageRow(agentKey: agentKey, message: message)
        }
      }
    }
  }

  private var summary: some View {
    Button {
      if expanded { model.expandedGroups.remove(id) } else { model.expandedGroups.insert(id) }
    } label: {
      HStack(spacing: 8) {
        Image(systemName: expanded ? Icon.chevronDown : Icon.chevronRight)
          .font(.system(size: 10, weight: .semibold))
          .foregroundStyle(theme.textMuted)
        Text("\(ToolGroups.countToolCalls(messages)) tool calls · \(messages.count) messages")
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
      .padding(.horizontal, 10)
      .padding(.vertical, 7)
      .background(theme.bgSecondary, in: RoundedRectangle(cornerRadius: theme.radiusSmall))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel("Collapsed tool calls")
    .accessibilityValue(expanded ? "expanded" : "collapsed")
  }

  private func icon(for category: ToolGroups.ToolCategory) -> String? {
    switch category {
    case .read: Icon.file
    case .search: Icon.search
    case .bash: Icon.terminal
    case .edit: Icon.pencil
    case .web: Icon.web
    case .agent: Icon.agent
    case .other: nil
    }
  }
}
