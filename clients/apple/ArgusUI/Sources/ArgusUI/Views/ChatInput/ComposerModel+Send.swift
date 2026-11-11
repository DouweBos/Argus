import ArgusCore
import ArgusKit
import Foundation

/// Sending, queueing and starting, the draft's load and save, and attachments.
extension ComposerModel {
  public func submit(redirect: ComposerStarter? = nil) {
    guard isEnabled, hasContent || sendTarget(redirect: redirect)?.needsContent == false else { return }
    let typed = trimmedText

    // Handled here rather than sent to the CLI, as on the desktop.
    if images.isEmpty, elements.isEmpty, linkedProjects.isEmpty, let local = SlashCommandMenu.local(typed) {
      clearComposer()
      switch local {
      case .togglePlan:
        setPermissionMode(permissionMode == .plan ? .auto : .plan)
      case .setModel(let model):
        if starter != nil {
          draftModel = model
        } else {
          Task { await host.setModel(agentId: agentId, model: model) }
        }
      case .openModelPicker:
        showingModelPicker = true
      }
      return
    }

    var display = typed.isEmpty && !images.isEmpty ? "(see attached images)" : typed
    var message = display
    if !elements.isEmpty {
      message = PickedElement.body(typed: display, elements: elements)
      display = PickedElement.display(typed: display, elements: elements)
    }
    let body = message.isEmpty ? "" : LinkedProjects.buildPreamble(paths: linkedProjects, message: message)
    // Shown instead of the context blocks; the preamble stays, the transcript draws it as chips.
    let shown = elements.isEmpty ? nil : LinkedProjects.buildPreamble(paths: linkedProjects, message: display)
    let attachments = elements.compactMap(\.crop) + images.map(\.attachment)
    if let target = sendTarget(redirect: redirect) {
      guard canSend(redirect: redirect) else { return }
      return start(with: target, body: body, display: display, images: attachments)
    }
    let queue = isRunning
    clearComposer()
    clearLinks()

    Task {
      if queue {
        // The bubble keeps the preamble: the transcript draws it as linked-project chips.
        await host.queueMessage(agentId: agentId, message: body, images: attachments, displayText: shown ?? body)
      } else {
        await host.sendMessage(
          agentId: agentId, message: body, images: attachments, displayText: shown, isRetry: false)
      }
    }
  }

  /// Starts the agent; the draft stays put until it has.
  private func start(
    with target: ComposerStarter, body: String, display: String, images attachments: [RemoteImageAttachment]
  ) {
    starting = true
    // Redirected from a live agent, the new one takes this one's settings.
    let live = starter == nil
    let request = ComposerStart(
      message: body, displayText: display, images: offersImagesAndEffort ? attachments : [],
      permissionMode: draftMode ?? (live ? permissionMode : nil),
      model: draftModel ?? (live ? status?.model : nil),
      effort: offersImagesAndEffort ? draftEffort ?? (live ? host.effortByAgent[agentId] : nil) : nil,
      runnerId: runner?.id, accountId: starter != nil && offersAccounts ? draftAccount : nil)
    Task {
      let started = await target.start(request)
      starting = false
      guard started else { return }
      clearComposer()
      clearLinks()
      draftMode = nil
      draftModel = nil
      draftEffort = nil
      draftAccount = nil
    }
  }

  private func clearComposer() {
    editor?.reset()
    text = ""
    caret = 0
    images = []
    elements = []
    preferences.remove(PreferenceKey.draft(agentId: agentId))
    draftImages.remove(agentId: agentId)
    if style == .desktop { editor?.focus() }
  }

  /// A link rides one message, like the desktop — not every one after it.
  private func clearLinks() {
    linkedProjects = []
    preferences.remove(PreferenceKey.linkedProjects(agentId: agentId))
  }

  // MARK: Draft

  /// Restores the draft, then fetches what the menus and pickers offer.
  public func load() async {
    text = preferences.string(PreferenceKey.draft(agentId: agentId)) ?? ""
    caret = text.utf16.count
    images = draftImages.load(agentId: agentId).compactMap(ImageAttachments.pending(restoring:))
    linkedProjects = preferences.decode(PreferenceKey.linkedProjects(agentId: agentId), as: [String].self) ?? []
    if style == .desktop { editor?.focus() }
    // Files first: capabilities wait on the CLI's first turn.
    if let sessionId {
      mentionFiles = await host.listFiles(sessionId: sessionId)
      mentionDirectories = MentionPicker.directories(of: mentionFiles)
      // The account picker reads the session's pin and the account list.
      if host.claudeAccounts == nil { await host.refreshClaudeAccounts() }
      if host.claudeAccountId(forSessionId: sessionId) == nil,
        let repoRoot = host.repoRoot(forSessionId: sessionId), host.sessionsByRepo[repoRoot] == nil
      {
        await host.loadSessions(repoRoot: repoRoot)
      }
    }
    guard starter == nil else {
      if let sessionId { await host.loadStartOptions(sessionId: sessionId, runnerId: nil) }
      return
    }
    await host.loadQueue(agentId: agentId)
    await host.loadCapabilities(agentId: agentId)
  }

  // MARK: Images

  /// Picked, pasted or shot images; `affordance` reports how, when the host can't tell.
  public func attach(_ pending: [PendingImage], via affordance: ChatInputAffordance? = nil) {
    guard !pending.isEmpty else { return }
    if let affordance { onAffordance?(affordance) }
    images.append(contentsOf: pending)
    saveImages()
  }

  public func removeImage(_ id: UUID) {
    images.removeAll { $0.id == id }
    saveImages()
  }

  /// Images ride the draft as its text does, so a switch away or a relaunch keeps them.
  private func saveImages() {
    draftImages.save(images.map(\.attachment), agentId: agentId)
  }

  // MARK: Elements

  public func attach(_ element: PickedElement) {
    elements.append(element)
  }

  public func removeElement(_ id: UUID) {
    elements.removeAll { $0.id == id }
  }

  /// Image files attach; any other file becomes an `@`-mention at the caret.
  func receive(_ drop: ComposerDrop) {
    guard isEnabled else { return }
    switch drop {
    case .element(let element):
      attach(element)
    case .images(let pending, let pasted):
      attach(pending, via: pasted ? .imagePaste : .imageDrop)
    case .files(let urls):
      attach(urls.filter(ImageAttachments.isImage).compactMap(ImageAttachments.pending(fromFile:)), via: .imageDrop)
      let others = urls.filter { !ImageAttachments.isImage($0) }
      guard !others.isEmpty else { break }
      onAffordance?(.fileMention)
      // A session on another machine gets the files uploaded first.
      Task {
        let dropped = await host.hostPaths(forDropped: others, sessionId: sessionId)
        guard !dropped.paths.isEmpty else { return }
        let edit = MentionPicker.insertingFileMentions(dropped.paths, into: text, caret: editor?.caret ?? caret)
        replaceText(edit.text, caret: edit.caret)
      }
    }
    editor?.focus()
  }
}
