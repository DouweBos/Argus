#if os(iOS)
  import ArgusCore
  import PhotosUI
  import SwiftUI

  /// The phone chat input: menus and suggestions over the attachments, the
  /// chip row of pickers, then the field with attach and send or queue.
  struct PhoneChatInputView: View {
    @Environment(\.theme) private var theme
    @Environment(HostStore.self) private var host

    @State private var composer: ComposerModel
    @State private var controller: PastingTextController
    @State private var handoffAccounts: [ArgusProtocol.LimitHandoffAccount] = []
    @State private var picker: PhoneComposerPicker?
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var showingCamera = false
    @State private var showingPhotoLibrary = false
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
      }
      .padding(theme.space)
      // The bar's own colour runs to the bottom edge, so it fills the
      // home-indicator strip and stays continuous as the keyboard moves.
      .background(theme.bgSecondary.ignoresSafeArea(edges: .bottom))
      .overlay(alignment: .top) { Rectangle().fill(theme.border).frame(height: 1) }
      .task(id: composer.agentId) { await composer.load() }
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
      // Compatible: HEIC arrives as JPEG, which the API reads and stays under the gateway's frame limit.
      .photosPicker(
        isPresented: $showingPhotoLibrary, selection: $photoItems, matching: .images,
        preferredItemEncoding: .compatible)
      .onChange(of: photoItems) { _, items in Task { await attach(items) } }
      .confirmationDialog("Attach", isPresented: $showingAttachMenu, titleVisibility: .hidden) {
        Button("Photo Library") { showingPhotoLibrary = true }
        Button("Take Photo") { showingCamera = true }
        Button("Cancel", role: .cancel) {}
      }
      .fullScreenCover(isPresented: $showingCamera) {
        CameraPicker { photo in
          composer.attach(ImageAttachments.pending(photo: photo).map { [$0] } ?? [], via: .imageAttach)
        }
      }
    }

    private var inputRow: some View {
      HStack(alignment: .bottom, spacing: 6) {
        IconBtn(systemName: Icon.plus, label: "Attach") { showingAttachMenu = true }

        ZStack(alignment: .topLeading) {
          PastingTextView(
            text: $composer.text, caret: $composer.caret, height: $inputHeight, controller: controller,
            onPasteImages: { pasted in
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
        } else {
          IconBtn(systemName: Icon.send, label: "Send", tint: theme.accent) { composer.submit() }
            .disabled(!composer.hasContent)
            .opacity(composer.hasContent ? 1 : 0.4)
        }
      }
    }

    private var attachmentStrip: some View {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 6) {
          ForEach(composer.images) { pending in
            Image(platformImage: pending.preview)
              .resizable()
              .scaledToFill()
              .frame(width: 56, height: 56)
              .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
              .overlay(alignment: .topTrailing) {
                Button {
                  composer.removeImage(pending.id)
                } label: {
                  Image(systemName: Icon.close)
                    .font(.scaled(size: 9, weight: .bold))
                    .foregroundStyle(theme.onAccent)
                    .padding(4)
                    .background(Circle().fill(theme.accent))
                }
                .buttonStyle(.argusPlain)
                .offset(x: 6, y: -6)
              }
          }
        }
        .padding(.top, 6)
      }
    }

    /// "Message" while empty; otherwise a command's argument hint or the rest of a follow-up, as ghost text.
    private var placeholder: Text? {
      if composer.text.isEmpty { return Text("Message").foregroundStyle(theme.textMuted) }
      guard let hint = composer.argumentHint else { return nil }
      return Text("\(Text(composer.text).foregroundStyle(.clear))\(Text(hint).foregroundStyle(theme.textMuted))")
    }

    private func attach(_ items: [PhotosPickerItem]) async {
      for item in items {
        guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
        composer.attach(ImageAttachments.pending(data: data).map { [$0] } ?? [], via: .imageAttach)
      }
      photoItems = []
    }
  }
#endif
