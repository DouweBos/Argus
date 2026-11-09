#if os(iOS)
  import ArgusCore
  import SwiftUI

  /// The phone chat input, the Mac's box: menus and suggestions above, then one
  /// rounded card with the attachments, the field, and the agent's settings as
  /// pills beside attach and send. With a starter it's a start composer, and a
  /// `composerFooter` strip tucks under the card.
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

        VStack(spacing: 0) {
          box
          if let footer { footer.padding(.horizontal, 12) }
        }
      }
      // An iPad or unfolded phone keeps the Mac's column instead of stretching the card edge to edge.
      .frame(maxWidth: ReadingColumn.maxWidth)
      .frame(maxWidth: .infinity)
      .padding(.horizontal, 10)
      .padding(.top, 6)
      .padding(.bottom, 8)
      // Runs to the bottom edge, so it fills the home-indicator strip as the keyboard moves.
      .background(theme.bg.ignoresSafeArea(edges: .bottom))
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

    private static let radius: CGFloat = 18

    private var box: some View {
      VStack(alignment: .leading, spacing: 0) {
        if !composer.images.isEmpty {
          attachmentStrip
            .padding(.horizontal, 10)
            .padding(.top, 10)
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
              .padding(.horizontal, 6)
              .padding(.vertical, 8)
              .allowsHitTesting(false)
          }
        }
        .frame(height: inputHeight)
        .padding(.horizontal, 8)
        .padding(.top, 6)
        HStack(alignment: .bottom, spacing: 4) {
          PhoneComposerPills(composer: composer, picker: $picker)
          actions
        }
        .padding(.leading, 6)
        .padding(.trailing, 8)
        .padding(.bottom, 8)
      }
      .background(theme.surface, in: .rect(cornerRadius: Self.radius))
      .overlay { RoundedRectangle(cornerRadius: Self.radius).strokeBorder(theme.border, lineWidth: 1) }
    }

    /// Attach, then send — or, while the agent works, queue and stop.
    private var actions: some View {
      HStack(spacing: 6) {
        if composer.contextTokens > 0 {
          ContextMeter(tokens: composer.contextTokens, limit: composer.contextLimit)
        }
        if composer.offersImagesAndEffort {
          Button { showingAttachMenu = true } label: { Label("Attach images", systemImage: Icon.paperclip) }
            .buttonStyle(FlatIconButtonStyle(size: 34))
            .disabled(!composer.isEnabled)
            // On the button, so the menu's popover points at it rather than the composer's middle.
            .phoneImageAttach(isPresented: $showingAttachMenu) { composer.attach($0, via: .imageAttach) }
        }
        if composer.isRunning {
          if composer.hasContent {
            ComposerRoundButton(kind: .send, label: "Queue message") { composer.submit() }
          }
          ComposerRoundButton(kind: .stop, label: "Interrupt") { composer.interrupt() }
        } else if composer.starting {
          ProgressView()
            .frame(width: TextScale.shared(ComposerRoundButton.side), height: TextScale.shared(ComposerRoundButton.side))
            .accessibilityLabel("Starting")
        } else {
          ComposerRoundButton(kind: .send, label: composer.starter == nil ? "Send" : "Start agent") {
            composer.submit(redirect: redirect)
          }
          .disabled(!composer.isEnabled || !composer.canSend(redirect: redirect))
        }
      }
      .frame(height: TextScale.shared(ComposerRoundButton.side))
    }

    private var attachmentStrip: some View {
      PendingImageStrip(images: composer.images) { composer.removeImage($0) }
    }

    /// "Message" while empty; otherwise a command's argument hint or the rest of a follow-up, as ghost text.
    private var placeholder: Text? {
      if composer.text.isEmpty {
        let ghost =
          !composer.isEnabled
          ? "Agent is not running" : (redirect ?? composer.starter)?.placeholder ?? "Ask anything, @ for files, / for commands"
        return Text(ghost).foregroundStyle(theme.textMuted)
      }
      guard let hint = composer.argumentHint else { return nil }
      return Text("\(Text(composer.text).foregroundStyle(.clear))\(Text(hint).foregroundStyle(theme.textMuted))")
    }
  }
#endif
