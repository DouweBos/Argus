import ArgusCore
import SwiftUI

/// The transcript: structured messages with inline tool calls, permission
/// forms, task lists, queued messages and the working indicator.
///
/// Live-refreshes off agent events with a poll as a backstop, and lazily loads
/// older history when you scroll to the top.
public struct AgentTranscriptView: View {
  @Environment(\.autoExpandImageReads) private var autoExpandImageReads
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host

  let agentKey: String
  /// A stopped agent's transcript is history; there is nothing to subscribe to.
  var isLive = true

  @State private var loadingOlder = false
  @State private var atBottom = true
  /// Opening an agent lands at the newest message; the first content pass
  /// jumps there without animating so it never reads as a scroll.
  @State private var hasLandedAtBottom = false
  @State private var rows = Rows()
  @State private var expandedLogs: Set<String> = []
  /// A turn's work log was opened; says whether the agent was still on it.
  var onWorkLogOpened: (Bool) -> Void = { _ in }

  private static let bottomAnchor = "transcript-bottom"

  private var messages: [RemoteMessage] { host.visibleMessages(for: agentKey) }

  /// The rows, regrouped only where the messages changed.
  private func items(_ messages: [RemoteMessage]) -> [TranscriptItem] {
    rows.items(messages, hoistImageReads: autoExpandImageReads)
  }

  public init(agentKey: String, isLive: Bool = true, onWorkLogOpened: @escaping (Bool) -> Void = { _ in }) {
    self.agentKey = agentKey
    self.isLive = isLive
    self.onWorkLogOpened = onWorkLogOpened
  }

  public var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 10) {
          topSentinel

          if let tasks = host.tasksByAgent[agentKey], !tasks.isEmpty {
            TaskListView(
              title: "Tasks",
              items: tasks.map { ($0.activeForm ?? $0.subject, $0.status, $0.owner) })
          }
          if let todos = host.todosByAgent[agentKey], !todos.isEmpty {
            TaskListView(
              title: "Todos",
              items: todos.map { ($0.activeForm ?? $0.content, $0.status, nil) })
          }

          ForEach(items(messages)) { item in
            switch item {
            case .message(let message):
              TranscriptMessageView(agentKey: agentKey, message: message)
            case .run(let group):
              ForEach(group) { TranscriptMessageView(agentKey: agentKey, message: $0) }
            case .work(let log):
              WorkLogRow(
                agentKey: agentKey, log: log, expanded: expandedBinding(log.id), onOpen: onWorkLogOpened)
            }
          }

          WorkingIndicator(
            status: host.statusByAgent[agentKey]?.status,
            pendingToolName: host.pendingToolByAgent[agentKey],
            pendingToolInput: nil,
            hasPendingPermission: hasPendingPermission)

          queued
          notSent

          Color.clear.frame(height: 1).id(Self.bottomAnchor)
        }
        .padding(theme.space)
      }
      .onChange(of: messages.count) { _, count in
        guard count > 0 else { return }
        if !hasLandedAtBottom {
          hasLandedAtBottom = true
          proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
          return
        }
        // Follow the tail only while the reader is already at it. Yanking
        // them out of history they deliberately scrolled back to is worse
        // than a missed message; they rejoin by scrolling back down.
        guard atBottom else { return }
        withAnimation(.easeOut(duration: 0.2)) {
          proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
        }
      }
      .onChange(of: agentKey) { _, _ in
        hasLandedAtBottom = false
        atBottom = true
        expandedLogs = []
      }
      // Over the scroll view, not in it: only the pane can centre it.
      .overlay {
        if messages.isEmpty, let error = host.transcriptErrorByAgent[agentKey] {
          EmptyState(icon: "exclamationmark.triangle", title: "Couldn't load this chat", body: error)
            .allowsHitTesting(false)
        } else if messages.isEmpty {
          EmptyState(
            icon: Icon.agent,
            title: "Nothing yet",
            body: isLive
              ? "Send this agent a message to get it going."
              : "This conversation has no saved messages.")
          .allowsHitTesting(false)
        }
      }
      .overlay(alignment: .bottomTrailing) {
        if !atBottom {
          Button {
            withAnimation { proxy.scrollTo(Self.bottomAnchor, anchor: .bottom) }
          } label: {
            Image(systemName: Icon.chevronDown)
              .font(.scaled(size: 13, weight: .bold))
              .foregroundStyle(theme.onAccent)
              .padding(10)
              .background(theme.accent)
              .clipShape(Circle())
          }
          .buttonStyle(.argusPlain)
          .padding(theme.space)
        }
      }
      .defaultScrollAnchor(.bottom, for: .initialOffset)
      // Scrolling the transcript by hand means you want to read it, not type.
      // `.immediately` rather than `.interactively`: the latter only gives way
      // when the drag reaches the keyboard, so an upward flick would keep it.
      .scrollDismissesKeyboard(.immediately)
      .onScrollGeometryChange(for: Bool.self) { geometry in
        geometry.contentOffset.y + geometry.containerSize.height
          >= geometry.contentSize.height - 60
      } action: { _, isAtBottom in
        atBottom = isAtBottom
      }
    }
    .task(id: agentKey) { await start() }
    .liveRefresh(enabled: host.connection == .ready, every: .seconds(5)) {
      await host.refreshTranscript(agentId: agentKey)
    }
    // Queue changes only ever arrive over the agent subscription, which the
    // lock screen takes down with the socket. Re-arm it and re-read the queue.
    .onResume(enabled: isLive, connected: host.connection == .ready) {
      await host.loadQueue(agentId: agentKey)
      await host.watchAgent(agentKey, on: true)
    }
    .onDisappear {
      guard isLive else { return }
      Task { await host.watchAgent(agentKey, on: false) }
    }
  }

  /// Scrolling this into view means the reader wants older history.
  private var topSentinel: some View {
    Group {
      if host.hasOlderMessages(for: agentKey) {
        HStack {
          Spacer()
          if loadingOlder {
            ProgressView().controlSize(.small)
            MutedText("Loading earlier messages…")
          }
          Spacer()
        }
        .frame(height: 28)
        .onAppear {
          guard !loadingOlder else { return }
          loadingOlder = true
          Task {
            await host.loadOlderMessages(agentId: agentKey)
            loadingOlder = false
          }
        }
      }
    }
  }

  private func expandedBinding(_ id: String) -> Binding<Bool> {
    Binding(
      get: { expandedLogs.contains(id) },
      set: { open in
        if open { expandedLogs.insert(id) } else { expandedLogs.remove(id) }
      })
  }

  private var hasPendingPermission: Bool {
    messages.contains { message in
      message.toolCalls.contains { host.hasPendingCall(agentKey: agentKey, in: $0) }
    }
  }

  /// Messages that never reached the computer. They sit below the queue
  /// because the queue is the computer's record and this is the absence of one.
  @ViewBuilder
  private var notSent: some View {
    let items = host.failedByAgent[agentKey] ?? []
    if !items.isEmpty {
      SectionHeader(title: "Not sent", count: items.count)
      ForEach(items) { item in
        FailedSendCard(agentKey: agentKey, item: item)
      }
    }
  }

  @ViewBuilder
  private var queued: some View {
    let items = host.queuedByAgent[agentKey] ?? []
    let sending = host.sendingQueuedByAgent[agentKey] ?? []
    if !items.isEmpty || !sending.isEmpty {
      SectionHeader(title: "Queued", count: items.count + sending.count)
      ForEach(items) { message in
        QueuedMessageCard(agentKey: agentKey, message: message)
      }
      ForEach(sending) { message in
        QueuedMessageCard(agentKey: agentKey, message: message, sending: true)
      }
    }
  }

  private func start() async {
    await host.loadTranscript(agentId: agentKey)
    guard isLive else { return }
    await host.loadQueue(agentId: agentKey)
    await host.watchAgent(agentKey, on: true)
    // Subscriptions are fire-and-forget, so an event emitted before the
    // gateway registered ours is simply lost — the first question being the
    // usual casualty. One catch-up fetch closes that window.
    try? await Task.sleep(for: .milliseconds(600))
    await host.loadTranscript(agentId: agentKey)
  }
}

/// The transcript's rows across renders. Unobserved: the messages they come from are.
@MainActor
private final class Rows {
  private var built = TranscriptItems()
  private var hoistImageReads = false

  func items(_ messages: [RemoteMessage], hoistImageReads: Bool) -> [TranscriptItem] {
    if hoistImageReads != self.hoistImageReads {
      self.hoistImageReads = hoistImageReads
      built = TranscriptItems(hoistImageReads: hoistImageReads)
    }
    built.update(messages)
    return built.items
  }
}

/// A message the computer never received. Shown as its own card rather than a
/// transcript bubble: a bubble reads as delivered, and this one was not.
public struct FailedSendCard: View {
  @Environment(HostStore.self) private var host

  let agentKey: String
  let item: FailedSend

  /// The attachments travel with the card as base64, so they are seeded into
  /// the same cache the transcript reads and render through the usual thumbnail.
  private var attachmentIds: [String] {
    item.images.indices.map { "failed:\(item.id):img:\($0)" }
  }

  private func seedAttachments() {
    for (index, image) in item.images.enumerated() {
      host.seedImage(
        agentId: agentKey,
        imageId: "failed:\(item.id):img:\(index)",
        dataURI: "data:\(image.mediaType);base64,\(image.data)")
    }
  }

  public init(agentKey: String, item: FailedSend) {
    self.agentKey = agentKey
    self.item = item
  }

  public var body: some View {
    Card {
      HStack(alignment: .top, spacing: 8) {
        Badge(label: "Not sent", tone: .danger)
        BodyText(item.text)
        Spacer(minLength: 4)
        IconBtn(systemName: Icon.refresh, label: "Send again", size: 13) {
          Task { await host.retryFailed(agentId: agentKey, id: item.id) }
        }
        IconBtn(systemName: Icon.close, label: "Discard message", size: 13) {
          host.discardFailed(agentId: agentKey, id: item.id)
        }
      }
      if !attachmentIds.isEmpty {
        HStack(spacing: 6) {
          ForEach(attachmentIds, id: \.self) { imageId in
            TranscriptImage(
              agentKey: agentKey, imageId: imageId,
              siblings: attachmentIds, maxHeight: 56)
          }
        }
      }
    }
    .task(id: item.id) { seedAttachments() }
  }
}

/// A message still waiting to be sent — editable in place, because a phone is
/// usually where you notice the typo.
public struct QueuedMessageCard: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host

  let agentKey: String
  let message: RemoteQueuedMessage
  /// Not on the computer yet, so there is nothing to edit or remove.
  var sending = false

  @State private var editing = false
  @State private var draft = ""
  @State private var confirmingRemove = false

  /// The stored text carries the linked-projects preamble; the editor only
  /// ever shows what the user typed, and the preamble is rebuilt on save.
  private var parsed: LinkedProjects.Parsed? {
    LinkedProjects.parsePreamble(message.text)
  }
  private var displayText: String {
    parsed?.rest ?? message.displayText ?? message.text
  }

  /// A queued message carries its attachments inline as base64, not as image
  /// refs to fetch. Seeding them into the same cache the transcript uses lets
  /// the ordinary thumbnail and the full-screen pager work unchanged.
  private var attachmentIds: [String] {
    (message.images ?? []).indices.map { "queued:\(message.id):img:\($0)" }
  }

  private func seedAttachments() {
    for (index, image) in (message.images ?? []).enumerated() {
      host.seedImage(
        agentId: agentKey,
        imageId: "queued:\(message.id):img:\(index)",
        dataURI: "data:\(image.mediaType);base64,\(image.data)")
    }
  }

  public init(agentKey: String, message: RemoteQueuedMessage, sending: Bool = false) {
    self.agentKey = agentKey
    self.message = message
    self.sending = sending
  }

  public var body: some View {
    Card {
      HStack(alignment: .top, spacing: 8) {
        Badge(label: sending ? "Sending" : "Queued")
        BodyText(displayText)
        Spacer(minLength: 4)
        if sending {
          ProgressView().controlSize(.mini)
        } else {
          if host.hasControl {
            IconBtn(systemName: Icon.send, label: "Send now", size: 13) {
              Task { await host.sendQueuedNow(agentId: agentKey, id: message.id) }
            }
            .help("Send now, into the agent's current turn")
          }
          IconBtn(systemName: Icon.pencil, label: "Edit queued message", size: 13) {
            draft = displayText
            editing = true
          }
          IconBtn(systemName: Icon.close, label: "Remove queued message", size: 13) {
            confirmingRemove = true
          }
        }
      }
      if !attachmentIds.isEmpty {
        HStack(spacing: 6) {
          ForEach(attachmentIds, id: \.self) { imageId in
            TranscriptImage(
              agentKey: agentKey, imageId: imageId,
              siblings: attachmentIds, maxHeight: 56)
          }
        }
      }
    }
    .task(id: message.id) { seedAttachments() }
    // A sheet, not an inline field: the transcript scrolls itself to the
    // newest message and dismisses the keyboard on any scroll, so an editor
    // living inside it loses both its place and the cursor.
    .sheet(isPresented: $editing) {
      QueuedMessageEditor(text: $draft, onSave: save)
    }
    .confirmationDialog(
      "Remove this queued message?", isPresented: $confirmingRemove, titleVisibility: .visible
    ) {
      Button("Remove", role: .destructive) {
        Task { await host.removeQueued(agentId: agentKey, id: message.id) }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(String(displayText.prefix(120)))
    }
  }

  private func save() {
    let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    let paths = parsed?.paths ?? []
    Task {
      // Cleared to nothing with no projects attached is a delete — there
      // would be no message left to send.
      if trimmed.isEmpty && paths.isEmpty {
        await host.removeQueued(agentId: agentKey, id: message.id)
      } else {
        await host.updateQueued(
          agentId: agentKey, id: message.id,
          message: LinkedProjects.buildPreamble(paths: paths, message: trimmed))
      }
    }
  }
}

/// Editing one queued message, over the transcript rather than inside it.
public struct QueuedMessageEditor: View {
  @Environment(\.dismiss) private var dismiss

  @Binding var text: String
  let onSave: () -> Void

  @FocusState private var focused: Bool

  public init(text: Binding<String>, onSave: @escaping () -> Void) {
    self._text = text
    self.onSave = onSave
  }

  public var body: some View {
    NavigationStack {
      Screen {
        Field(label: "Message", caption: "Sent when the agent finishes its turn.") {
          ThemedTextField(placeholder: "Message", text: $text, multiline: true, lines: 4...16)
            .focused($focused)
        }
      }
      .navigationTitle("Edit Queued Message")
      .inlineNavigationTitle()
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Save") {
            onSave()
            dismiss()
          }
        }
      }
      .task { focused = true }
    }
    .presentationDetents([.medium, .large])
  }
}
