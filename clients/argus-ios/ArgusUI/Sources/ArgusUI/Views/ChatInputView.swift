import ArgusCore
import PhotosUI
import SwiftUI

/// The chat input: send or queue a message, attach images, switch model,
/// Claude account, permission mode and effort, and link other projects.
///
/// Only rendered for a device holding the control grant — the gateway refuses
/// every one of these otherwise.
public struct ChatInputView: View {
  private enum Picker: String, Identifiable {
    case model, account, mode, effort, project
    var id: String { rawValue }
  }

  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  private let preferences = Preferences()

  let agentId: String
  let sessionId: String?

  @State private var text = ""
  @State private var linkedProjects: [String] = []
  @State private var attachments: [RemoteImageAttachment] = []
  @State private var previews: [PlatformImage] = []
  @State private var picker: Picker?
  @State private var photoItems: [PhotosPickerItem] = []
  @State private var showingCamera = false
  @State private var showingPhotoLibrary = false
  @State private var showingAttachMenu = false
  @State private var mentionFiles: [String] = []
  @State private var browseEntries: [RemoteMentionEntry] = []
  @State private var browseResolvedPath = ""
  /// Browse lookups are async and the user keeps typing; only the newest
  /// response is allowed to land.
  @State private var browseRequest = 0
  @State private var inputHeight = PastingTextView.collapsedHeight
  @FocusState private var focused: Bool

  private var status: RemoteAgentStatus? { host.statusByAgent[agentId] }
  private var isRunning: Bool { status?.status == .running }
  private var capabilities: RemoteAgentCapabilities {
    host.capabilitiesByAgent[agentId] ?? .empty
  }
  private var hasContent: Bool {
    !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty
  }

  public init(agentId: String, sessionId: String? = nil) {
    self.agentId = agentId
    self.sessionId = sessionId
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if !slashSuggestions.isEmpty {
        suggestionList(slashSuggestions.map(\.name), hint: slashSuggestions.map(\.description))
      } else if !mentionItems.isEmpty {
        mentionList
      }

      if !previews.isEmpty { attachmentStrip }

      chipRow
      inputRow
    }
    .padding(theme.space)
    // The bar's own colour runs to the bottom edge, so it fills the
    // home-indicator strip and stays continuous as the keyboard moves.
    .background(theme.bgSecondary.ignoresSafeArea(edges: .bottom))
    .overlay(alignment: .top) { Rectangle().fill(theme.border).frame(height: 1) }
    .task(id: agentId) { await load() }
    .onChange(of: text) { _, value in
      preferences.set(value, for: PreferenceKey.draft(agentId: agentId))
      Task { await refreshBrowse() }
    }
    .sheet(item: $picker) { which in pickerSheet(which) }
    .photosPicker(isPresented: $showingPhotoLibrary, selection: $photoItems, matching: .images)
    .onChange(of: photoItems) { _, items in Task { await attach(items) } }
    .confirmationDialog("Attach", isPresented: $showingAttachMenu, titleVisibility: .hidden) {
      Button("Photo Library") { showingPhotoLibrary = true }
      #if os(iOS)
        Button("Take Photo") { showingCamera = true }
      #endif
      Button("Cancel", role: .cancel) {}
    }
    #if os(iOS)
      .fullScreenCover(isPresented: $showingCamera) {
        CameraPicker { image in append(image) }
      }
    #endif
  }

  // MARK: Rows

  private var chipRow: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 6) {
        Spacer(minLength: 0).frame(width: 1)
        if contextTokens > 0 {
          ContextMeter(
            tokens: contextTokens,
            limit: status?.contextWindow
              ?? ContextWindow.limit(forModel: status?.model, capabilities: capabilities))
        }
        Chip(label: modelLabel, icon: Icon.agent) { picker = .model }
        // With one account there's nothing to switch between.
        if sessionId != nil, (host.claudeAccounts?.count ?? 0) > 1 {
          Chip(label: accountLabel, icon: Icon.person) { picker = .account }
        }
        Chip(
          label: mode.label, icon: Icon.lock,
          tone: mode == .auto ? nil : .accent
        ) { picker = .mode }
        if currentModelSupportsEffort {
          Chip(label: host.effortByAgent[agentId] ?? "effort", icon: Icon.clock) {
            picker = .effort
          }
        }
        Chip(
          label: linkedProjects.isEmpty ? "Link project" : "\(linkedProjects.count) linked",
          icon: Icon.link
        ) { picker = .project }
      }
    }
  }

  private var inputRow: some View {
    HStack(alignment: .bottom, spacing: 6) {
      IconBtn(systemName: Icon.plus, label: "Attach") { showingAttachMenu = true }

      ZStack(alignment: .topLeading) {
        PastingTextView(
          text: $text,
          height: $inputHeight,
          placeholder: "Message",
          onPasteImages: { images in images.forEach(append) })
        if text.isEmpty {
          Text("Message")
            .font(.system(size: 15))
            .foregroundStyle(theme.textMuted)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .allowsHitTesting(false)
        }
      }
      .frame(height: inputHeight)
      .padding(.horizontal, 4)
      .background(theme.bgTertiary)
      .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))

      if isRunning {
        if hasContent {
          IconBtn(systemName: Icon.send, label: "Queue message", tint: theme.accent) {
            submit()
          }
        }
        IconBtn(systemName: Icon.stop, label: "Interrupt", tint: theme.error) {
          Task { await host.interrupt(agentId: agentId) }
        }
      } else {
        IconBtn(systemName: Icon.send, label: "Send", tint: theme.accent) { submit() }
          .disabled(!hasContent)
          .opacity(hasContent ? 1 : 0.4)
      }
    }
  }

  private var attachmentStrip: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 6) {
        ForEach(Array(previews.enumerated()), id: \.offset) { index, image in
          Image(platformImage: image)
            .resizable()
            .scaledToFill()
            .frame(width: 56, height: 56)
            .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
            .overlay(alignment: .topTrailing) {
              Button {
                previews.remove(at: index)
                attachments.remove(at: index)
              } label: {
                Image(systemName: Icon.close)
                  .font(.system(size: 9, weight: .bold))
                  .foregroundStyle(theme.onAccent)
                  .padding(4)
                  .background(Circle().fill(theme.accent))
              }
              .buttonStyle(.plain)
              .offset(x: 6, y: -6)
            }
        }
      }
      .padding(.top, 6)
    }
  }

  private func suggestionList(_ items: [String], hint: [String]?) -> some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        ForEach(Array(items.enumerated()), id: \.offset) { index, item in
          Button {
            acceptCommand(item)
          } label: {
            VStack(alignment: .leading, spacing: 1) {
              Text(item).font(.system(size: 14)).foregroundStyle(theme.text)
              if let hint, index < hint.count, !hint[index].isEmpty {
                Text(hint[index])
                  .font(.system(size: 11))
                  .foregroundStyle(theme.textMuted)
                  .lineLimit(1)
              }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
        }
      }
    }
    .frame(maxHeight: 190)
    .padding(.horizontal, 8)
    .background(theme.bgTertiary)
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
  }

  // MARK: Autocomplete

  /// Slash commands only while the first token is still being typed.
  private var slashSuggestions: [RemoteSlashCommand] {
    guard text.hasPrefix("/"), !text.contains(" "), !text.contains("\n") else { return [] }
    let needle = String(text.dropFirst()).lowercased()
    return capabilities.commands
      .filter { needle.isEmpty || $0.name.lowercased().contains(needle) }
      .prefix(8)
      .map { $0 }
  }

  private var mentionQuery: String? { MentionQuery.detect(in: text) }

  private var isBrowsing: Bool {
    mentionQuery.map(MentionQuery.isBrowsing) ?? false
  }

  private struct MentionItem: Identifiable {
    enum Kind { case useDirectory, directory, file }
    var kind: Kind
    /// What gets inserted, or drilled into.
    var path: String
    var label: String
    var id: String { "\(kind)-\(path)" }
  }

  private var mentionItems: [MentionItem] {
    guard mentionQuery != nil else { return [] }
    return isBrowsing ? browseItems : searchItems
  }

  private var browseItems: [MentionItem] {
    guard !browseResolvedPath.isEmpty else { return [] }
    // The directory itself is a valid mention, and there is no other way to
    // pick it once you have drilled into it.
    let useThis = MentionItem(
      kind: .useDirectory, path: browseResolvedPath, label: "Use this directory")
    return [useThis]
      + browseEntries.map { entry in
        MentionItem(
          kind: entry.isDir ? .directory : .file,
          path: MentionQuery.childPath(browseResolvedPath, entry.name),
          label: entry.name)
      }
  }

  private var searchItems: [MentionItem] {
    guard let query = mentionQuery, !mentionFiles.isEmpty else { return [] }
    return MentionQuery.search(mentionFiles, query: query)
      .map { MentionItem(kind: .file, path: $0, label: $0) }
  }

  private var mentionHeader: String {
    isBrowsing ? (browseResolvedPath.isEmpty ? "Files" : browseResolvedPath) : "Files"
  }

  /// Completing a slash command replaces the whole first token.
  private func acceptCommand(_ name: String) {
    text = "/\(name) "
  }

  private var mentionList: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(mentionHeader)
        .font(.system(size: 10, weight: .bold))
        .foregroundStyle(theme.textMuted)
        .lineLimit(1)
        .truncationMode(.head)
        .padding(.top, 6)
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(mentionItems) { item in
            Button {
              select(item)
            } label: {
              HStack(spacing: 6) {
                Image(systemName: icon(for: item.kind))
                  .font(.system(size: 11))
                  .foregroundStyle(theme.textMuted)
                Text(item.label)
                  .font(.system(size: 14))
                  .foregroundStyle(item.kind == .useDirectory ? theme.accent : theme.text)
                  .lineLimit(1)
                  .truncationMode(.head)
                Spacer(minLength: 0)
                if item.kind == .directory {
                  Image(systemName: Icon.chevronRight)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(theme.textMuted)
                }
              }
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(.vertical, 6)
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
          }
        }
      }
      .frame(maxHeight: 190)
    }
    .padding(.horizontal, 8)
    .padding(.bottom, 4)
    .background(theme.bgTertiary)
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
  }

  private func icon(for kind: MentionItem.Kind) -> String {
    switch kind {
    case .useDirectory: Icon.check
    case .directory: Icon.folder
    case .file: Icon.file
    }
  }

  /// A directory drills in and keeps the picker open; anything else inserts
  /// the mention and dismisses it.
  private func select(_ item: MentionItem) {
    let isDirectory = item.kind == .directory
    text = MentionQuery.replacing(in: text, with: item.path, isDirectory: isDirectory)
    if isDirectory {
      Task { await refreshBrowse() }
    }
  }

  private func refreshBrowse() async {
    guard isBrowsing, let query = mentionQuery, let sessionId else {
      browseEntries = []
      browseResolvedPath = ""
      return
    }
    browseRequest += 1
    let request = browseRequest
    let result = await host.resolveMentionPath(sessionId: sessionId, query: query)
    // The user kept typing while this was in flight.
    guard request == browseRequest else { return }
    browseEntries = result?.entries ?? []
    browseResolvedPath = result?.resolvedPath ?? ""
  }

  // MARK: Pickers

  private var mode: RemotePermissionMode {
    RemotePermissionMode(rawValue: status?.permissionMode ?? "") ?? .auto
  }

  private var modelLabel: String {
    guard let value = status?.model else { return "Model" }
    return capabilities.models.first { $0.value == value }?.displayName ?? value
  }

  /// Sentinel picker value for "follow the computer's active account".
  private static let followDefaultAccount = ""

  private var pinnedAccountId: String? {
    sessionId.flatMap { host.claudeAccountId(forSessionId: $0) }
  }

  private func accountName(_ id: String?) -> String? {
    host.claudeAccounts?.first { $0.id == id }?.displayName
  }

  private var accountLabel: String {
    accountName(pinnedAccountId) ?? "Default account"
  }

  private var currentModelSupportsEffort: Bool {
    capabilities.models.first { $0.value == status?.model }?.supportsEffort == true
  }

  @ViewBuilder
  private func pickerSheet(_ which: Picker) -> some View {
    switch which {
    case .model:
      PickerSheet(
        title: "Model",
        options: capabilities.models.map {
          .init(value: $0.value, label: $0.displayName, hint: $0.description)
        },
        selected: Set([status?.model].compactMap { $0 }),
        emptyMessage: "This agent hasn't reported its models yet."
      ) { value in
        Task { await host.setModel(agentId: agentId, model: value) }
      }
    case .account:
      PickerSheet(
        title: "Account",
        options: [
          .init(
            value: Self.followDefaultAccount, label: "Follow computer default",
            hint: accountName(host.activeClaudeAccountId))
        ]
          + (host.claudeAccounts ?? []).map {
            .init(
              value: $0.id, label: $0.displayName,
              hint: $0.subtitle.isEmpty ? nil : $0.subtitle)
          },
        selected: [pinnedAccountId ?? Self.followDefaultAccount]
      ) { value in
        guard let sessionId else { return }
        let accountId = value == Self.followDefaultAccount ? nil : value
        Task {
          await host.setSessionClaudeAccount(
            sessionId: sessionId, accountId: accountId, agentId: agentId)
        }
      }
    case .mode:
      PickerSheet(
        title: "Permission mode",
        options: RemotePermissionMode.allCases.map { .init(value: $0.rawValue, label: $0.label) },
        selected: [mode.rawValue]
      ) { value in
        guard let picked = RemotePermissionMode(rawValue: value) else { return }
        Task { await host.setPermissionMode(agentId: agentId, mode: picked) }
      }
    case .effort:
      let levels =
        capabilities.models.first { $0.value == status?.model }?.supportedEffortLevels ?? []
      PickerSheet(
        title: "Effort",
        options: levels.map { .init(value: $0, label: $0.capitalized) },
        selected: Set([host.effortByAgent[agentId]].compactMap { $0 })
      ) { value in
        Task { await host.setEffort(agentId: agentId, level: value) }
      }
    case .project:
      PickerSheet(
        title: "Linked projects",
        options: host.projects.map { .init(value: $0.repoRoot, label: $0.name, hint: $0.repoRoot) },
        selected: Set(linkedProjects),
        multi: true
      ) { value in
        if let index = linkedProjects.firstIndex(of: value) {
          linkedProjects.remove(at: index)
        } else {
          linkedProjects.append(value)
        }
        preferences.encode(
          linkedProjects, for: PreferenceKey.linkedProjects(agentId: agentId))
      }
    }
  }

  // MARK: Actions

  private var contextTokens: Int {
    // The most recent assistant turn carrying usage is the live figure.
    let messages = host.visibleMessages(for: agentId)
    guard let usage = messages.reversed().first(where: { $0.usage != nil })?.usage else {
      return 0
    }
    return ContextWindow.tokensInContext(usage)
  }

  private func submit() {
    let typed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    let display = typed.isEmpty ? "(see attached images)" : typed
    let body = LinkedProjects.buildPreamble(paths: linkedProjects, message: display)
    let images = attachments

    text = ""
    attachments = []
    previews = []
    // Collapse outright. Re-measuring an emptied text view has proved too
    // easy to get wrong, and the answer for no text is never in doubt.
    inputHeight = PastingTextView.collapsedHeight
    preferences.remove(PreferenceKey.draft(agentId: agentId))
    // A link rides one message, like the desktop — not every one after it.
    linkedProjects = []
    preferences.remove(PreferenceKey.linkedProjects(agentId: agentId))

    Task {
      if isRunning {
        await host.queueMessage(
          agentId: agentId, message: body, images: images, displayText: display)
      } else {
        await host.sendMessage(
          agentId: agentId, message: body, images: images, displayText: display)
      }
    }
  }

  private func load() async {
    text = preferences.string(PreferenceKey.draft(agentId: agentId)) ?? ""
    linkedProjects =
      preferences.decode(PreferenceKey.linkedProjects(agentId: agentId), as: [String].self)
      ?? []
    await host.loadCapabilities(agentId: agentId)
    if let sessionId {
      mentionFiles = await host.listFiles(sessionId: sessionId)
      // The account chip reads the session's pin and the account list.
      if host.claudeAccounts == nil { await host.refreshClaudeAccounts() }
      if host.claudeAccountId(forSessionId: sessionId) == nil,
        let repoRoot = host.repoRoot(forSessionId: sessionId),
        host.sessionsByRepo[repoRoot] == nil
      {
        await host.loadSessions(repoRoot: repoRoot)
      }
    }
  }

  private func attach(_ items: [PhotosPickerItem]) async {
    for item in items {
      guard let data = try? await item.loadTransferable(type: Data.self),
        let image = PlatformImage(data: data)
      else { continue }
      append(image)
    }
    photoItems = []
  }

  private func append(_ image: PlatformImage) {
    guard let jpeg = image.jpegData(quality: 0.8) else { return }
    previews.append(image)
    attachments.append(
      RemoteImageAttachment(data: jpeg.base64EncodedString(), mediaType: "image/jpeg"))
  }
}
