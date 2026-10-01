#if os(macOS)
  import AppKit
  import ArgusCore
  import SwiftUI
  import UniformTypeIdentifiers

  /// The Mac chat input, matching the desktop's: Return sends (or queues while
  /// the agent works), ⇧Return breaks the line, `/` and `@` open keyboard-driven
  /// menus, images paste, drop or attach, and the agent's model, permission
  /// mode and effort sit in menus underneath.
  struct MacChatInputView: View {
    @Environment(\.theme) var theme
    @Environment(HostStore.self) var host
    let preferences = Preferences()

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
    @State var showingModelPopover = false

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
        if !slashItems.isEmpty {
          SlashSuggestionList(items: slashItems, selected: menuIndex) { acceptSlash($0) }
        } else if let mention = mentionContext, !mentionItems.isEmpty {
          MentionSuggestionList(
            header: MentionPicker.header(for: mention), items: mentionItems, selected: menuIndex
          ) { acceptMention($0) }
        }
        if !images.isEmpty {
          AttachmentStrip(images: images) { id in images.removeAll { $0.id == id } }
        }
        inputRow
        controlRow
      }
      .padding(.horizontal, theme.space)
      .padding(.vertical, 8)
      .background(theme.bgSecondary)
      .overlay(alignment: .top) { Rectangle().fill(theme.border).frame(height: 1) }
      .task(id: agentId) { await load() }
      .onChange(of: text) { _, value in
        preferences.set(value, for: PreferenceKey.draft(agentId: agentId))
        if dismissedText != value { dismissedText = nil }
        menuIndex = 0
      }
      .onChange(of: mentionContext?.query) { _, _ in Task { await refreshBrowse() } }
    }

    // MARK: Rows

    private var inputRow: some View {
      HStack(alignment: .bottom, spacing: 6) {
        IconBtn(systemName: Icon.paperclip, label: "Attach images", size: 15) { pickImages() }
          .help("Attach images")
          .disabled(!isEnabled)

        ComposerField(
          text: $text, caret: $caret, height: $height, isDropTarget: $isDropTarget,
          controller: controller,
          placeholder: isEnabled
            ? "Message the agent… (Enter to send, / for commands, @ for files)"
            : "Agent is not running",
          argumentHint: SlashCommandMenu.argumentHint(for: text, in: commands),
          isEnabled: isEnabled,
          onKey: handle,
          onDrop: receive)
          .frame(height: height)
          .background(theme.bgTertiary)
          .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
          .overlay {
            RoundedRectangle(cornerRadius: theme.radiusSmall)
              .strokeBorder(isDropTarget ? theme.accent : theme.border, lineWidth: 1)
          }

        if isRunning {
          if hasContent {
            IconBtn(systemName: Icon.send, label: "Queue message", tint: theme.accent) { submit() }
              .help("Queue — sent when the agent finishes its turn")
          }
          IconBtn(systemName: Icon.stop, label: "Interrupt", tint: theme.error) { interrupt() }
            .help("Interrupt (⌘.)")
        } else {
          IconBtn(systemName: Icon.send, label: "Send", tint: theme.accent) { submit() }
            .disabled(!hasContent || !isEnabled)
            .opacity(hasContent && isEnabled ? 1 : 0.4)
            .help("Send (Return)")
        }
      }
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

    private func handle(_ key: ComposerKey) -> Bool {
      switch ComposerKeymap.action(for: key, menuOpen: menuCount > 0, isRunning: isRunning) {
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
      }
      return true
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
      case .files(let urls):
        let pending = urls.filter(ImageAttachments.isImage).compactMap(
          ImageAttachments.pending(fromFile:))
        if !pending.isEmpty {
          onAffordance?(.imageDrop)
          images.append(contentsOf: pending)
        }
        let others = urls.filter { !ImageAttachments.isImage($0) }.map(\.path)
        guard !others.isEmpty else { return }
        onAffordance?(.fileMention)
        let edit = MentionPicker.insertingFileMentions(
          others, into: text, caret: controller.caret)
        controller.replace(with: edit.text, caret: edit.caret)
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
          showingModelPopover = true
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
      controller.focus()
    }

    func interrupt() {
      Task { await host.interrupt(agentId: agentId) }
    }

    private func load() async {
      text = preferences.string(PreferenceKey.draft(agentId: agentId)) ?? ""
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
