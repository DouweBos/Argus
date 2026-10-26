#if os(macOS)
  import AppKit
  import ArgusCore
  import SwiftUI
  import UniformTypeIdentifiers

  /// The Mac chat input, one box in the reading column: Return sends (or queues
  /// while the agent works), ⇧Return breaks the line, `/` and `@` open
  /// keyboard-driven menus, images paste, drop or attach, and the agent's
  /// model, effort and permission mode sit in pills along its foot.
  struct MacChatInputView: View {
    @Environment(\.theme) var theme
    @Environment(HostStore.self) var host
    @Environment(\.composerTyping) var composerTyping
    @Environment(\.composerDropInbox) var dropInbox
    @Environment(\.composerFocusRequest) var focusRequest
    let preferences = Preferences()
    let draftImages = DraftAttachments()

    let agentId: String
    let sessionId: String?
    let onAffordance: ((ChatInputAffordance) -> Void)?

    @State var text = ""
    @State var caret = 0
    @State var height = ComposerField.minHeight
    @State var isDropTarget = false
    @State var images: [PendingImage] = []
    @State var linkedProjects: [String] = []
    @State var controller = ComposerController()
    /// Esc closes a menu until the text changes again.
    @State var dismissedText: String?
    @State var menuIndex = 0
    @State var mentionFiles: [String] = []
    @State var mentionDirectories: [String] = []
    @State var browseDirectory: String?
    @State var browseEntries: [(name: String, isDirectory: Bool)] = []
    /// Browse lookups race the typing; only the newest may land.
    @State var browseRequest = 0
    @State var showingModelMenu = false

    var status: RemoteAgentStatus? { host.statusByAgent[agentId] }
    var isRunning: Bool { status?.status == .running }
    /// The desktop only takes input from a live agent.
    var isEnabled: Bool { status.map { $0.status != .stopped && $0.status != .error } ?? true }
    var capabilities: RemoteAgentCapabilities { host.capabilitiesByAgent[agentId] ?? .empty }
    var hasContent: Bool {
      !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !images.isEmpty
    }

    var commands: [SlashCommandMenu.Command] {
      SlashCommandMenu.merged(capabilities.commands.map(SlashCommandMenu.Command.init))
    }

    var body: some View {
      VStack(alignment: .leading, spacing: 6) {
        if let at = ChatInputView.pendingLimitResume(status) {
          Banner(text: Labels.limitResumeBanner(at), actionLabel: "Cancel") {
            Task { await host.dismissLimitResume(agentId: agentId) }
          }
        }
        if !slashItems.isEmpty {
          SlashSuggestionList(items: slashItems, selected: menuIndex) { acceptSlash($0) }
        } else if let mention = mentionContext, !mentionItems.isEmpty {
          MentionSuggestionList(
            header: MentionPicker.header(for: mention), items: mentionItems, selected: menuIndex
          ) { acceptMention($0) }
        } else if !hasContent, !followUps.isEmpty {
          FollowUpSuggestionRow(items: followUps) { acceptFollowUp($0) }
        }
        box
      }
      .readingColumn()
      .padding(.top, 6)
      .padding(.bottom, 14)
      .task(id: agentId) { await load() }
      .onChange(of: focusRequest) { _, _ in controller.focus() }
      .onChange(of: text) { _, value in
        preferences.set(value, for: PreferenceKey.draft(agentId: agentId))
        if dismissedText != value { dismissedText = nil }
        menuIndex = 0
        composerTyping?(agentId, !value.isEmpty)
      }
      .onChange(of: mentionContext?.query) { _, _ in Task { await refreshBrowse() } }
      .onChange(of: dropInbox?.generation) { _, _ in
        let drops = dropInbox?.take() ?? []
        if isEnabled { drops.forEach(receive) }
      }
    }

    // MARK: Box

    /// One rounded box: attachments, the text, then the agent's settings as
    /// pills and the attach and send buttons.
    private var box: some View {
      VStack(alignment: .leading, spacing: 0) {
        if !images.isEmpty {
          AttachmentStrip(images: images) { id in
            images.removeAll { $0.id == id }
            saveImages()
          }
          .padding(.horizontal, 10)
          .padding(.top, 10)
        }
        ComposerField(
          text: $text, caret: $caret, height: $height, isDropTarget: $isDropTarget,
          controller: controller,
          placeholder: isEnabled
            ? followUps.first.map { "\($0)  (Tab)" } ?? "Ask anything, @ for files, / for commands"
            : "Agent is not running",
          argumentHint: SlashCommandMenu.argumentHint(for: text, in: commands)
            ?? FollowUps.completion(for: text, in: followUps),
          isEnabled: isEnabled,
          onKey: handle,
          onDrop: receive)
          .frame(height: height)
          .padding(.horizontal, 6)
          .padding(.top, 4)
        HStack(alignment: .bottom, spacing: 6) {
          controlRow
          actions
        }
        .padding(.leading, 8)
        .padding(.trailing, 8)
        .padding(.bottom, 8)
      }
      .background(theme.surface, in: .rect(cornerRadius: Self.radius))
      .overlay {
        RoundedRectangle(cornerRadius: Self.radius)
          .strokeBorder(isDropTarget ? theme.accent : theme.border, lineWidth: 1)
      }
    }

    private static let radius: CGFloat = 16

    /// Attach, then send — or, while the agent works, queue and stop.
    private var actions: some View {
      HStack(spacing: 6) {
        if contextTokens > 0 {
          ContextMeter(
            tokens: contextTokens,
            limit: status?.contextWindow
              ?? ContextWindow.limit(forModel: status?.model, capabilities: capabilities))
        }
        Button(action: pickImages) { Label("Attach images", systemImage: Icon.paperclip) }
          .buttonStyle(FlatIconButtonStyle(size: 26))
          .help("Attach images")
          .disabled(!isEnabled)
        if isRunning {
          if hasContent {
            ComposerRoundButton(kind: .send, label: "Queue message") { submit() }
              .help("Queue — sent when the agent finishes its turn")
          }
          ComposerRoundButton(kind: .stop, label: "Interrupt") { interrupt() }
            .help("Interrupt (⌘.)")
        } else {
          ComposerRoundButton(kind: .send, label: "Send") { submit() }
            .disabled(!hasContent || !isEnabled)
            .help("Send (Return)")
        }
      }
      .frame(height: TextScale.shared(26))
    }

    // MARK: Menus

    var slashItems: [SlashCommandMenu.Command] {
      guard dismissedText != text else { return [] }
      return SlashCommandMenu.suggestions(for: text, in: commands)
    }

    var mentionContext: MentionPicker.Context? {
      guard dismissedText != text else { return nil }
      return MentionPicker.detect(in: text, caret: caret)
    }

    var mentionItems: [MentionPicker.Item] {
      guard let context = mentionContext else { return [] }
      guard MentionPicker.isBrowsing(context.query) else {
        return MentionPicker.search(
          files: mentionFiles, directories: mentionDirectories, query: context.query)
      }
      let (directory, filter) = MentionPicker.splitBrowse(context.query)
      guard browseDirectory == directory else { return [] }
      return MentionPicker.browse(directory: directory, entries: browseEntries, filter: filter)
    }

    private var menuCount: Int { slashItems.isEmpty ? mentionItems.count : slashItems.count }

    /// Replies suggested once the last turn ended, while the agent waits.
    var followUps: [String] {
      guard isEnabled, !isRunning else { return [] }
      return host.followUpsByAgent[agentId] ?? []
    }

    private func handle(_ key: ComposerKey) -> Bool {
      let followUp = FollowUps.accepted(for: text, in: followUps)
      switch ComposerKeymap.action(
        for: key, menuOpen: menuCount > 0, isRunning: isRunning, hasFollowUp: followUp != nil)
      {
      case .passThrough:
        return false
      case .ignore:
        return true
      case .send:
        submit()
      case .menuMove(let delta):
        menuIndex = ComposerKeymap.move(menuIndex, by: delta, count: menuCount)
      case .menuAccept:
        if !slashItems.isEmpty, slashItems.indices.contains(menuIndex) {
          acceptSlash(slashItems[menuIndex])
        } else if mentionItems.indices.contains(menuIndex) {
          acceptMention(mentionItems[menuIndex])
        }
      case .menuDismiss:
        dismissedText = text
      case .cyclePermissionMode:
        onAffordance?(.permissionCycle)
        let next = ComposerPermissionMode.next(
          after: ComposerPermissionMode.canonical(status?.permissionMode))
        Task { await host.setPermissionMode(agentId: agentId, mode: next) }
      case .interrupt:
        onAffordance?(.interruptShortcut)
        interrupt()
      case .acceptFollowUp:
        if let followUp { acceptFollowUp(followUp) }
      }
      return true
    }

    private func acceptFollowUp(_ reply: String) {
      onAffordance?(.followUp)
      controller.replace(with: reply)
      controller.focus()
    }

    private func acceptSlash(_ command: SlashCommandMenu.Command) {
      onAffordance?(.slashCommand)
      controller.replace(with: SlashCommandMenu.accepted(command))
      controller.focus()
    }

    private func acceptMention(_ item: MentionPicker.Item) {
      guard let context = mentionContext else { return }
      if !item.isDirectory || item.isLinkAction { onAffordance?(.mention) }
      let edit = MentionPicker.apply(item, in: context, to: text)
      controller.replace(with: edit.text, caret: edit.caret)
      controller.focus()
    }

    private func refreshBrowse() async {
      guard let context = mentionContext, MentionPicker.isBrowsing(context.query),
        let sessionId
      else { return }
      let directory = MentionPicker.splitBrowse(context.query).directory
      guard directory != browseDirectory else { return }
      browseRequest += 1
      let request = browseRequest
      let result = await host.resolveMentionPath(sessionId: sessionId, query: directory)
      guard request == browseRequest else { return }
      browseDirectory = directory
      browseEntries = (result?.entries ?? []).map { ($0.name, $0.isDir) }
    }

    // MARK: Images

    private func receive(_ drop: ComposerDrop) {
      switch drop {
      case .images(let pending, let pasted):
        onAffordance?(pasted ? .imagePaste : .imageDrop)
        images.append(contentsOf: pending)
        saveImages()
      case .files(let urls):
        let pending = urls.filter(ImageAttachments.isImage).compactMap(
          ImageAttachments.pending(fromFile:))
        if !pending.isEmpty {
          onAffordance?(.imageDrop)
          images.append(contentsOf: pending)
          saveImages()
        }
        let others = urls.filter { !ImageAttachments.isImage($0) }
        guard !others.isEmpty else { return }
        onAffordance?(.fileMention)
        // A session on another machine gets the files uploaded first.
        Task {
          let dropped = await host.hostPaths(forDropped: others, sessionId: sessionId)
          guard !dropped.paths.isEmpty else { return }
          let edit = MentionPicker.insertingFileMentions(
            dropped.paths, into: text, caret: controller.caret)
          controller.replace(with: edit.text, caret: edit.caret)
        }
      }
      controller.focus()
    }

    private func pickImages() {
      let panel = NSOpenPanel()
      panel.allowsMultipleSelection = true
      panel.canChooseDirectories = false
      panel.allowedContentTypes = ImageAttachments.acceptedTypes
      panel.message = "Attach images"
      let finish: (NSApplication.ModalResponse) -> Void = { response in
        guard response == .OK else { return }
        let pending = panel.urls.compactMap(ImageAttachments.pending(fromFile:))
        if !pending.isEmpty { onAffordance?(.imageAttach) }
        images.append(contentsOf: pending)
        saveImages()
        controller.focus()
      }
      if let window = NSApp.keyWindow {
        panel.beginSheetModal(for: window, completionHandler: finish)
      } else {
        finish(panel.runModal())
      }
    }

    // MARK: Sending

    func submit() {
      guard isEnabled, hasContent else { return }
      let typed = text.trimmingCharacters(in: .whitespacesAndNewlines)

      if images.isEmpty, linkedProjects.isEmpty, let local = SlashCommandMenu.local(typed) {
        clearComposer()
        switch local {
        case .togglePlan:
          let current = ComposerPermissionMode.canonical(status?.permissionMode)
          Task {
            await host.setPermissionMode(agentId: agentId, mode: current == .plan ? .auto : .plan)
          }
        case .setModel(let model):
          Task { await host.setModel(agentId: agentId, model: model) }
        case .openModelPicker:
          showingModelMenu = true
        }
        return
      }

      let display = typed.isEmpty ? "(see attached images)" : typed
      let body = LinkedProjects.buildPreamble(paths: linkedProjects, message: display)
      let attachments = images.map(\.attachment)
      let queue = isRunning
      clearComposer()
      // A link rides one message, like the desktop — not every one after it.
      linkedProjects = []
      preferences.remove(PreferenceKey.linkedProjects(agentId: agentId))

      Task {
        if queue {
          await host.queueMessage(
            agentId: agentId, message: body, images: attachments, displayText: display)
        } else {
          await host.sendMessage(
            agentId: agentId, message: body, images: attachments, displayText: display)
        }
      }
    }

    private func clearComposer() {
      controller.reset()
      text = ""
      images = []
      height = ComposerField.minHeight
      preferences.remove(PreferenceKey.draft(agentId: agentId))
      draftImages.remove(agentId: agentId)
      controller.focus()
    }

    /// Images ride the draft as its text does, so a switch away or a relaunch keeps them.
    private func saveImages() {
      draftImages.save(images.map(\.attachment), agentId: agentId)
    }

    func interrupt() {
      Task { await host.interrupt(agentId: agentId) }
    }

    private func load() async {
      text = preferences.string(PreferenceKey.draft(agentId: agentId)) ?? ""
      images = draftImages.load(agentId: agentId).compactMap(ImageAttachments.pending(restoring:))
      linkedProjects =
        preferences.decode(PreferenceKey.linkedProjects(agentId: agentId), as: [String].self)
        ?? []
      controller.focus()
      // Files first: capabilities wait on the CLI's first turn.
      if let sessionId {
        mentionFiles = await host.listFiles(sessionId: sessionId)
        mentionDirectories = MentionPicker.directories(of: mentionFiles)
        if host.claudeAccounts == nil { await host.refreshClaudeAccounts() }
      }
      await host.loadQueue(agentId: agentId)
      await host.loadCapabilities(agentId: agentId)
    }
  }
#endif
