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
    @Environment(\.composerRedirect) var redirect
    @Environment(\.composerFooter) var footer

    @State var composer: ComposerModel
    @State var controller: ComposerController
    @State var height = ComposerField.minHeight
    @State var isDropTarget = false
    @State var handoffAccounts: [ArgusProtocol.LimitHandoffAccount] = []
    @State var showingSideQuestion = false

    init(
      host: HostStore, agentId: String, sessionId: String?, onAffordance: ((ChatInputAffordance) -> Void)?,
      starter: ComposerStarter?
    ) {
      let controller = ComposerController()
      let composer = ComposerModel(
        agentId: agentId, sessionId: sessionId, host: host, starter: starter, style: .desktop, editor: controller)
      composer.onAffordance = onAffordance
      _controller = State(initialValue: controller)
      _composer = State(initialValue: composer)
    }

    var body: some View {
      VStack(alignment: .leading, spacing: 6) {
        if let at = ChatInputView.pendingLimitResume(composer.status) {
          Banner(text: Labels.limitResumeBanner(at), actionLabel: "Cancel") {
            Task { await host.dismissLimitResume(agentId: composer.agentId) }
          }
        }
        if !handoffAccounts.isEmpty {
          LimitHandoffCard(agentId: composer.agentId, accounts: handoffAccounts) { handoffAccounts = [] }
        }
        if composer.slashItems.isEmpty, composer.mentionItems.isEmpty, !composer.hasContent,
          !composer.followUps.isEmpty
        {
          FollowUpSuggestionRow(items: composer.followUps) { composer.acceptFollowUp($0) }
        }
        VStack(spacing: 0) {
          box.overlay(alignment: .top) { suggestions }
          if let footer {
            footer.padding(.horizontal, 14)
          }
        }
      }
      .readingColumn()
      .padding(.top, 6)
      .padding(.bottom, 14)
      .task(id: composer.agentId) { await composer.load() }
      // Which affordances the agent's runner supports.
      .task { await host.loadRunners() }
      // A start's runner pick: its models, and the host's warm agent on it.
      .onChange(of: composer.runner?.id) { _, runnerId in
        guard composer.starter != nil, let sessionId = composer.sessionId else { return }
        Task {
          await host.reportViewing(sessionId: sessionId, runnerId: runnerId)
          await host.loadStartOptions(sessionId: sessionId, runnerId: runnerId)
        }
      }
      .limitHandoffOffer(agentId: composer.agentId, status: composer.status, into: $handoffAccounts)
      .onChange(of: focusRequest) { _, _ in controller.focus() }
      .onChange(of: composer.text) { _, value in
        if value.isEmpty { height = ComposerField.minHeight }
        if composer.starter == nil { composerTyping?(composer.agentId, !value.isEmpty) }
      }
      .onChange(of: dropInbox?.generation) { _, _ in
        (dropInbox?.take() ?? []).forEach(composer.receive)
      }
    }

    /// The `/` and `@` menus float above the box like a popover, so opening one
    /// moves neither the box nor what's around it.
    @ViewBuilder private var suggestions: some View {
      Group {
        if !composer.slashItems.isEmpty {
          SlashSuggestionList(items: composer.slashItems, selected: composer.menuIndex) { composer.acceptSlash($0) }
        } else if !composer.mentionItems.isEmpty {
          MentionSuggestionList(
            header: composer.mentionHeader, items: composer.mentionItems, selected: composer.menuIndex
          ) { composer.acceptMention($0) }
        }
      }
      .alignmentGuide(.top) { $0[.bottom] + 6 }
    }

    // MARK: Box

    /// One rounded box: attachments, the text, then the agent's settings as
    /// pills and the attach and send buttons.
    private var box: some View {
      VStack(alignment: .leading, spacing: 0) {
        if !composer.images.isEmpty || !composer.elements.isEmpty {
          AttachmentStrip(
            images: composer.images, elements: composer.elements, removeElement: composer.removeElement
          ) { composer.removeImage($0) }
          .padding(.horizontal, 10)
          .padding(.top, 10)
        }
        ComposerField(
          text: $composer.text, caret: $composer.caret, height: $height, isDropTarget: $isDropTarget,
          controller: controller,
          placeholder: composer.isEnabled
            ? composer.followUps.first.map { "\($0)  (Tab)" } ?? "Ask anything, @ for files, / for commands"
            : "Agent is not running",
          argumentHint: composer.argumentHint,
          isEnabled: composer.isEnabled,
          onKey: { composer.handle($0, redirect: redirect) },
          onDrop: composer.receive)
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
        if composer.contextTokens > 0 {
          ContextMeter(tokens: composer.contextTokens, limit: composer.contextLimit)
        }
        Button(action: pickImages) { Label("Attach images", systemImage: Icon.paperclip) }
          .buttonStyle(FlatIconButtonStyle(size: 26))
          .help("Attach images")
          .disabled(!composer.isEnabled)
        if composer.isRunning {
          if composer.hasContent {
            ComposerRoundButton(kind: .send, label: "Queue message") { composer.submit(redirect: redirect) }
              .help("Queue — sent when the agent finishes its turn")
          }
          ComposerRoundButton(kind: .stop, label: "Interrupt") { composer.interrupt() }
            .help("Interrupt (⌘.)")
        } else {
          ComposerRoundButton(kind: .send, label: "Send") { composer.submit(redirect: redirect) }
            .disabled(!composer.canSend(redirect: redirect) || !composer.isEnabled)
            .help("Send (Return)")
        }
      }
      .frame(height: TextScale.shared(26))
    }

    private func pickImages() {
      let panel = NSOpenPanel()
      panel.allowsMultipleSelection = true
      panel.canChooseDirectories = false
      panel.allowedContentTypes = ImageAttachments.acceptedTypes
      panel.message = "Attach images"
      let finish: (NSApplication.ModalResponse) -> Void = { response in
        guard response == .OK else { return }
        composer.attach(panel.urls.compactMap(ImageAttachments.pending(fromFile:)), via: .imageAttach)
        controller.focus()
      }
      if let window = NSApp.keyWindow {
        panel.beginSheetModal(for: window, completionHandler: finish)
      } else {
        finish(panel.runModal())
      }
    }
  }
#endif
