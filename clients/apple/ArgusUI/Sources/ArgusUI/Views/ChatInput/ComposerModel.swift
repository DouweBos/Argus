import ArgusCore
import ArgusKit
import Foundation
import Observation

/// The composer's state and actions, shared by the Mac and phone inputs: the
/// draft (text, images, linked projects), the `/` and `@` menus, the model,
/// effort, mode and account pickers, and sending, queueing or starting.
/// The platform views only render it.
@MainActor
@Observable
public final class ComposerModel {
  /// What differs between the Mac and the phone beyond layout.
  public enum Style: Sendable {
    /// Takes input only from a live agent; focuses on load and after a send.
    case desktop
    /// Never grabs focus on its own, which would raise the keyboard.
    case phone
  }

  public let agentId: String
  public let sessionId: String?
  /// Set: there's no agent yet, and sending starts one.
  public let starter: ComposerStarter?
  public let style: Style

  @ObservationIgnored let host: any ComposerHost
  @ObservationIgnored let editor: (any ComposerEditor)?
  @ObservationIgnored let preferences: Preferences
  @ObservationIgnored let draftImages: DraftAttachments
  @ObservationIgnored public var onAffordance: ((ChatInputAffordance) -> Void)?

  public var text = "" {
    didSet { textChanged() }
  }
  /// UTF-16 offset of the insertion point, as the editor reports it.
  public var caret = 0 {
    didSet { if caret != oldValue { mentionMayHaveMoved() } }
  }
  public internal(set) var images: [PendingImage] = []
  /// Picked in the browser or the device inspector; they live with the composer, not the saved draft.
  public internal(set) var elements: [PickedElement] = []
  public internal(set) var linkedProjects: [String] = []
  /// Esc closes a menu until the text changes again.
  var dismissedText: String?
  public var menuIndex = 0
  var mentionFiles: [String] = []
  var mentionDirectories: [String] = []
  var browseDirectory: String?
  var browseEntries: [(name: String, isDirectory: Bool)] = []
  /// Browse lookups race the typing; only the newest may land.
  @ObservationIgnored var browseRequest = 0
  @ObservationIgnored private var lastMentionQuery: String?
  /// `/model` with no argument asks the view to open its model picker.
  public var showingModelPicker = false
  /// `/usage-limits` opened the limits panel; the next send closes it.
  public var showingUsageLimits = false
  /// A start composer's picks, handed to the agent it starts.
  var draftMode: RemotePermissionMode?
  var draftModel: String?
  var draftEffort: String?
  /// A start's account pick; nil keeps the session's own pin.
  var draftAccount: String?
  /// A start composer's runner; nil is the computer's default.
  public internal(set) var runner: RemoteRunner?
  /// Two or more turn the start into a compare run; empty is a single start.
  public internal(set) var compareSlots: [CompareSlot] = []
  /// A start that can't carry images or effort (one per Linear issue) hides both.
  public var offersImagesAndEffort = true
  public internal(set) var starting = false
  public internal(set) var dictation: DictationPhase = .idle
  @ObservationIgnored let makeDictationEngine: @MainActor () -> any DictationEngine
  @ObservationIgnored var dictationRun: DictationRun?

  public init(
    agentId: String, sessionId: String?, host: any ComposerHost, starter: ComposerStarter? = nil,
    style: Style, editor: (any ComposerEditor)? = nil, preferences: Preferences = Preferences(),
    draftImages: DraftAttachments = DraftAttachments(),
    dictationEngine: @escaping @MainActor () -> any DictationEngine = DictationEngines.live
  ) {
    self.agentId = agentId
    self.sessionId = sessionId
    self.host = host
    self.starter = starter
    compareSlots = starter?.compareSlots ?? []
    self.style = style
    self.editor = editor
    self.preferences = preferences
    self.draftImages = draftImages
    self.makeDictationEngine = dictationEngine
  }

  // MARK: Agent

  public var status: RemoteAgentStatus? { host.statusByAgent[agentId] }
  public var isRunning: Bool { status?.status == .running }

  /// The desktop only takes input from a live agent.
  public var isEnabled: Bool {
    if starting { return false }
    if starter != nil || style == .phone { return true }
    return status.map { $0.status != .stopped && $0.status != .error } ?? true
  }

  /// A side question forks the conversation, so an agent with nothing said yet has none to ask about.
  public var hasConversation: Bool { starter == nil && !host.visibleMessages(for: agentId).isEmpty }

  /// A start composer offers the CLI its start will take; an agent, its own.
  public var capabilities: RemoteAgentCapabilities {
    if starter != nil, let sessionId { return host.startOptionsBySession[sessionId] ?? .empty }
    return host.capabilitiesByAgent[agentId] ?? .empty
  }

  public var hasContent: Bool { !trimmedText.isEmpty || !images.isEmpty || !elements.isEmpty }

  var trimmedText: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

  /// Where sending starts an agent, when it doesn't go to the one here.
  func sendTarget(redirect: ComposerStarter?) -> ComposerStarter? { redirect ?? starter }

  public func canSend(redirect: ComposerStarter? = nil) -> Bool {
    // Dictated words land for review; nothing goes out mid-sentence.
    guard !dictation.isActive else { return false }
    let target = sendTarget(redirect: redirect)
    guard target?.ready != false, hasContent || target?.needsContent == false else { return false }
    return target?.needsText != true || !trimmedText.isEmpty
  }

  /// Replies suggested once the last turn ended, while the agent waits.
  public var followUps: [String] {
    guard isEnabled, !isRunning else { return [] }
    return host.followUpsByAgent[agentId] ?? []
  }

  /// The most recent assistant turn carrying usage is the live figure.
  public var contextTokens: Int {
    let messages = host.visibleMessages(for: agentId)
    guard let usage = messages.reversed().first(where: { $0.usage != nil })?.usage else { return 0 }
    return ContextWindow.tokensInContext(usage)
  }

  public var contextLimit: Int {
    status?.contextWindow ?? ContextWindow.limit(forModel: status?.model, capabilities: capabilities)
  }

  // MARK: Menus

  public var commands: [SlashCommandMenu.Command] {
    SlashCommandMenu.merged(
      capabilities.commands.map(SlashCommandMenu.Command.init),
      local: usageLimitGroups.isEmpty ? [] : [SlashCommandMenu.usageLimits])
  }

  /// The plan limits this agent's runner draws on, from the host's last snapshot.
  public var usageLimitGroups: [UsageLimitGroup] {
    guard starter == nil else { return [] }
    return UsageLimitFormat.groups(host.usageLimits, runner: status?.runnerId)
  }

  public var slashItems: [SlashCommandMenu.Command] {
    guard dismissedText != text else { return [] }
    return SlashCommandMenu.suggestions(for: text, in: commands)
  }

  public var mentionContext: MentionPicker.Context? {
    guard dismissedText != text else { return nil }
    return MentionPicker.detect(in: text, caret: caret)
  }

  public var mentionItems: [MentionPicker.Item] {
    guard let context = mentionContext else { return [] }
    guard MentionPicker.isBrowsing(context.query) else {
      return MentionPicker.search(files: mentionFiles, directories: mentionDirectories, query: context.query)
    }
    let (directory, filter) = MentionPicker.splitBrowse(context.query)
    guard browseDirectory == directory else { return [] }
    return MentionPicker.browse(directory: directory, entries: browseEntries, filter: filter)
  }

  public var mentionHeader: String { mentionContext.map(MentionPicker.header(for:)) ?? "Files" }

  var menuCount: Int { slashItems.isEmpty ? mentionItems.count : slashItems.count }

  /// After an accepted `/command `, its argument hint; else the rest of a typed-into follow-up.
  public var argumentHint: String? {
    SlashCommandMenu.argumentHint(for: text, in: commands) ?? FollowUps.completion(for: text, in: followUps)
  }

  private func textChanged() {
    preferences.set(text, for: PreferenceKey.draft(agentId: agentId))
    if dismissedText != text { dismissedText = nil }
    menuIndex = 0
    mentionMayHaveMoved()
  }

  private func mentionMayHaveMoved() {
    let query = mentionContext?.query
    guard query != lastMentionQuery else { return }
    lastMentionQuery = query
    Task { await refreshBrowse() }
  }

  func refreshBrowse() async {
    guard let context = mentionContext, MentionPicker.isBrowsing(context.query), let sessionId else { return }
    let directory = MentionPicker.splitBrowse(context.query).directory
    guard directory != browseDirectory else { return }
    browseRequest += 1
    let request = browseRequest
    let result = await host.resolveMentionPath(sessionId: sessionId, query: directory)
    guard request == browseRequest else { return }
    browseDirectory = directory
    browseEntries = (result?.entries ?? []).map { ($0.name, $0.isDir) }
  }

  public func acceptFollowUp(_ reply: String) {
    onAffordance?(.followUp)
    replaceText(reply)
    editor?.focus()
  }

  public func acceptSlash(_ command: SlashCommandMenu.Command) {
    onAffordance?(.slashCommand)
    replaceText(SlashCommandMenu.accepted(command))
    editor?.focus()
  }

  public func acceptMention(_ item: MentionPicker.Item) {
    guard let context = mentionContext else { return }
    if !item.isDirectory || item.isLinkAction { onAffordance?(.mention) }
    let edit = MentionPicker.apply(item, in: context, to: text)
    replaceText(edit.text, caret: edit.caret)
    editor?.focus()
  }

  /// Through the editor when there is one, so the edit is undoable and the caret lands.
  func replaceText(_ new: String, caret newCaret: Int? = nil) {
    if let editor {
      editor.replace(with: new, caret: newCaret)
    } else {
      text = new
      caret = min(newCaret ?? new.utf16.count, new.utf16.count)
    }
  }

  /// Returns whether the key was handled, as `ComposerKeymap` decides it.
  public func handle(_ key: ComposerKey, redirect: ComposerStarter? = nil) -> Bool {
    let followUp = FollowUps.accepted(for: text, in: followUps)
    switch ComposerKeymap.action(for: key, menuOpen: menuCount > 0, isRunning: isRunning, hasFollowUp: followUp != nil) {
    case .passThrough:
      return false
    case .ignore:
      return true
    case .send:
      submit(redirect: redirect)
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
      setPermissionMode(ComposerPermissionMode.next(after: permissionMode))
    case .interrupt:
      onAffordance?(.interruptShortcut)
      interrupt()
    case .acceptFollowUp:
      if let followUp { acceptFollowUp(followUp) }
    }
    return true
  }
}
