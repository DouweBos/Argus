#if os(iOS)
  import ArgusCore
  import SwiftUI

  /// The phone chat input: menus and suggestions over the attachments, the
  /// chip row of pickers, then the field with attach and send or queue. With a
  /// starter it's a start composer, and a `composerFooter` sits under the field.
  struct PhoneChatInputView: View {
    @Environment(\.theme) private var theme
    @Environment(HostStore.self) private var host
    @Environment(\.composerRedirect) private var redirect
    @Environment(\.composerFooter) private var footer

    @State private var composer: ComposerModel
    @State private var controller: PastingTextController
    @State private var handoffAccounts: [ArgusProtocol.LimitHandoffAccount] = []
    @State private var picker: PhoneComposerPicker?
    @State private var showingAttachMenu = false
    @State private var inputHeight = PastingTextView.collapsedHeight

    init(host: HostStore, agentId: String, sessionId: String?, onAffordance: ((ChatInputAffordance) -> Void)?) {
      let controller = PastingTextController()
      let composer = ComposerModel(
        agentId: agentId, sessionId: sessionId, host: host, style: .phone, editor: controller)
      composer.onAffordance = onAffordance
      _controller = State(initialValue: controller)
      _composer = State(initialValue: composer)
    }

    /// Over a composer the caller holds, as a start composer does to set its runner.
    init(composer: ComposerModel, controller: PastingTextController) {
      _controller = State(initialValue: controller)
      _composer = State(initialValue: composer)
    }

    var body: some View {
      VStack(alignment: .leading, spacing: 8) {
        if let at = ChatInputView.pendingLimitResume(composer.status) {
          Banner(text: Labels.limitResumeBanner(at), actionLabel: "Cancel") {
            Task { await host.dismissLimitResume(agentId: composer.agentId) }
          }
        }
        if !handoffAccounts.isEmpty {
          LimitHandoffCard(agentId: composer.agentId, accounts: handoffAccounts) { handoffAccounts = [] }
        }
        if !composer.slashItems.isEmpty {
          PhoneSlashList(commands: composer.slashItems) { composer.acceptSlash($0) }
        } else if !composer.mentionItems.isEmpty {
          PhoneMentionList(header: composer.mentionHeader, items: composer.mentionItems) {
            composer.acceptMention($0)
          }
        } else if !composer.hasContent, !composer.followUps.isEmpty {
          FollowUpSuggestionRow(items: composer.followUps) { composer.acceptFollowUp($0) }
        }

        if !composer.images.isEmpty { attachmentStrip }

        PhoneComposerChips(composer: composer, picker: $picker)
        inputRow
        if let footer { footer }
      }
      .padding(theme.space)
      // The bar's own colour runs to the bottom edge, so it fills the
      // home-indicator strip and stays continuous as the keyboard moves.
      .background(theme.bgSecondary.ignoresSafeArea(edges: .bottom))
      .overlay(alignment: .top) { Rectangle().fill(theme.border).frame(height: 1) }
      .task(id: composer.agentId) { await composer.load() }
      // Which affordances the agent's runner supports.
      .task { await host.loadRunners() }
      .limitHandoffOffer(agentId: composer.agentId, status: composer.status, into: $handoffAccounts)
      .onChange(of: composer.text) { _, value in
        // Collapse outright. Re-measuring an emptied text view has proved too
        // easy to get wrong, and the answer for no text is never in doubt.
        if value.isEmpty { inputHeight = PastingTextView.collapsedHeight }
      }
      .onChange(of: composer.showingModelPicker) { _, showing in
        guard showing else { return }
        composer.showingModelPicker = false
        picker = .model
      }
      .sheet(item: $picker) { PhoneComposerPickerSheet(composer: composer, which: $0) }
    }

    private var inputRow: some View {
      HStack(alignment: .bottom, spacing: 6) {
        if composer.offersImagesAndEffort {
          IconBtn(systemName: Icon.plus, label: "Attach") { showingAttachMenu = true }
            // On the button, so the menu's popover points at it rather than the composer's middle.
            .phoneImageAttach(isPresented: $showingAttachMenu) { composer.attach($0, via: .imageAttach) }
        }

        ZStack(alignment: .topLeading) {
          PastingTextView(
            text: $composer.text, caret: $composer.caret, height: $inputHeight, controller: controller,
            onPasteImages: { pasted in
              guard composer.offersImagesAndEffort else { return }
              composer.attach(pasted.compactMap(ImageAttachments.pending(image:)), via: .imagePaste)
            })
          if let ghost = placeholder {
            ghost
              .font(.scaled(size: 15))
              .padding(.horizontal, 10)
              .padding(.vertical, 8)
              .allowsHitTesting(false)
          }
        }
        .frame(height: inputHeight)
        .padding(.horizontal, 4)
        .background(theme.bgTertiary)
        .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))

        if composer.isRunning {
          if composer.hasContent {
            IconBtn(systemName: Icon.send, label: "Queue message", tint: theme.accent) { composer.submit() }
          }
          IconBtn(systemName: Icon.stop, label: "Interrupt", tint: theme.error) { composer.interrupt() }
        } else if composer.starting {
          ProgressView().frame(width: IconBtn.side, height: IconBtn.side).accessibilityLabel("Starting")
        } else {
          let canSend = composer.isEnabled && composer.canSend(redirect: redirect)
          IconBtn(
            systemName: Icon.send, label: composer.starter == nil ? "Send" : "Start agent", tint: theme.accent
          ) { composer.submit(redirect: redirect) }
          .disabled(!canSend)
          .opacity(canSend ? 1 : 0.4)
        }
      }
    }

    private var attachmentStrip: some View {
      PendingImageStrip(images: composer.images) { composer.removeImage($0) }
    }

    /// "Message" while empty; otherwise a command's argument hint or the rest of a follow-up, as ghost text.
    private var placeholder: Text? {
      if composer.text.isEmpty {
        let ghost = (redirect ?? composer.starter)?.placeholder ?? "Message"
        return Text(ghost).foregroundStyle(theme.textMuted)
      }
      guard let hint = composer.argumentHint else { return nil }
      return Text("\(Text(composer.text).foregroundStyle(.clear))\(Text(hint).foregroundStyle(theme.textMuted))")
    }
  }
#endif
