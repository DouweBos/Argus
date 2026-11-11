import ArgusUI
import SwiftUI

/// One message: badges, attachments, its text as one selectable TextKit view,
/// and its tool calls. A call waiting on a decision is drawn in the prompt
/// area at the bottom instead, so it never shows twice.
struct TranscriptMessageRow: View, Equatable {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(TranscriptModel.self) private var model

  let agentKey: String
  let message: RemoteMessage
  /// Its own timestamp tooltip, inside an open tool group. A row of its own
  /// gets one from its cell only while hovered: a live tooltip per row is
  /// re-evaluated on every scrolled frame.
  var tip = false

  private var isUser: Bool { message.role == .user }

  /// A stream update rebuilds the transcript; rows whose message didn't change
  /// skip their body. What they read from the store still invalidates them.
  nonisolated static func == (a: Self, b: Self) -> Bool {
    a.agentKey == b.agentKey && a.message == b.message && a.tip == b.tip
  }

  private var calls: [RemoteToolCall] {
    message.toolCalls.filter { !host.isToolCallPending(agentKey: agentKey, call: $0) }
  }

  @ViewBuilder
  var body: some View {
    if tip { row.help(timestamp) } else { row }
  }

  /// A sent message's bubble takes at most this share of the column.
  private static let bubbleFraction: CGFloat = 0.7
  private static let bubblePadding = EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12)

  /// How wide a user bubble lays out in a column this wide.
  static func bubbleWidth(of text: TranscriptRendered, in width: CGFloat) -> CGFloat {
    let inset = bubblePadding.leading + bubblePadding.trailing
    let room = (width * bubbleFraction).rounded(.down) - inset
    let fitted = TranscriptMessageTextView.size(of: text, forWidth: room, fills: false)
    return fitted.width + inset
  }

  @ViewBuilder
  private var row: some View {
    if let handoff = message.handoff {
      HandoffDivider(handoff: handoff)
    } else if isUser {
      // A sent message: a quiet bubble at the trailing edge, at most 70% of the column.
      TrailingFractionLayout(fraction: Self.bubbleFraction) { content }
    } else {
      content.frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private var content: some View {
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
  }

  private func textView(_ text: TranscriptRendered) -> some View {
    let unit = TranscriptModel.textUnit(message.id)
    let current = model.currentHit.flatMap { $0.unitId == unit ? $0.range : nil }
    return TranscriptMessageText(
      rendered: text, unit: message.id, highlights: model.hitsByUnit[unit] ?? [], current: current,
      revealToken: current == nil ? 0 : model.pendingReveal, fills: !isUser,
      onRevealed: { model.revealedToken = $0 }
    )
    .padding(isUser ? Self.bubblePadding : EdgeInsets())
    .background {
      if isUser {
        RoundedRectangle(cornerRadius: theme.radius).fill(theme.bgSecondary)
      }
    }
  }

  private var timestamp: String { Self.timestamp(message) }

  static func timestamp(_ message: RemoteMessage) -> String {
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

/// A turn's work — its tool calls and the narration between them — folded
/// into one quiet line that opens in place. Open state lives in the model so
/// find can open a log that holds the match.
struct TranscriptWorkLog: View, Equatable {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(TranscriptModel.self) private var model

  let agentKey: String
  let log: WorkLog

  private var expanded: Bool { model.expandedGroups.contains(log.id) }
  /// The newest thing in the chat while the agent is still at it.
  /// Still at it: the newest thing in a running chat, or a background agent it launched is.
  private var working: Bool {
    log.stillRunning != nil || (log.ended == nil && host.statusByAgent[agentKey]?.status == .running)
  }

  nonisolated static func == (a: Self, b: Self) -> Bool {
    a.agentKey == b.agentKey && a.log == b.log
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      summary
      if expanded {
        ForEach(log.messages) { message in
          TranscriptMessageRow(agentKey: agentKey, message: message, tip: true)
        }
      }
      Rectangle().fill(theme.borderSubtle).frame(height: 1)
    }
  }

  private var summary: some View {
    Button {
      if expanded {
        model.expandedGroups.remove(log.id)
      } else {
        model.expandedGroups.insert(log.id)
        MacTelemetry.capture(.transcriptWorkLogOpened(working: working))
      }
    } label: {
      HStack(spacing: 4) {
        if working {
          TimelineView(.periodic(from: .now, by: 1)) { context in
            Text(label(now: context.date))
          }
        } else {
          Text(label(now: .now))
        }
        Image(systemName: Icon.chevronRight)
          .font(.scaled(size: 9, weight: .semibold))
          .rotationEffect(.degrees(expanded ? 90 : 0))
      }
      .font(.scaled(size: 12))
      .foregroundStyle(theme.textMuted)
      .contentShape(Rectangle())
    }
    .buttonStyle(.argusPlain)
    .help(log.callCountLabel)
    .accessibilityLabel(label(now: .now))
    .accessibilityValue(expanded ? "expanded" : "collapsed")
  }

  private func label(now: Date) -> String { log.label(working: working, now: now) }
}
