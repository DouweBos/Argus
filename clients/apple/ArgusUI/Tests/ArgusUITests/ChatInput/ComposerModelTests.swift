import ArgusCore
import ArgusKit
import Foundation
import Testing

@testable import ArgusUI

@MainActor
@Suite("ComposerModel")
struct ComposerModelTests {
  private let host = FakeComposerHost()
  private let suite = "composer-tests-\(UUID().uuidString)"
  private let drafts = DraftAttachments(
    directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))

  private var preferences: Preferences { Preferences(suiteName: suite) }

  private func model(
    status: RemoteAgentState? = .idle, starter: ComposerStarter? = nil, style: ComposerModel.Style = .desktop,
    editor: (any ComposerEditor)? = nil
  ) -> ComposerModel {
    if let status { host.statusByAgent["a1"] = .fake(status) }
    return ComposerModel(
      agentId: "a1", sessionId: "s1", host: host, starter: starter, style: style, editor: editor,
      preferences: preferences, draftImages: drafts)
  }

  @Test("an idle agent is sent the message; the draft clears")
  func send() async {
    let composer = model()
    composer.text = "  fix the build  "
    composer.submit()
    await settle()
    #expect(host.sent.map(\.message) == ["fix the build"])
    #expect(host.queued.isEmpty)
    #expect(composer.text.isEmpty)
    #expect(preferences.string(PreferenceKey.draft(agentId: "a1")) == nil)
  }

  @Test("a running agent gets the message queued")
  func queue() async {
    let composer = model(status: .running)
    composer.text = "next"
    composer.submit()
    await settle()
    #expect(host.queued.map(\.message) == ["next"])
    #expect(host.sent.isEmpty)
  }

  @Test("images alone send as \"(see attached images)\"; links ride one message")
  func imagesAndLinks() async throws {
    let composer = model()
    let image = try #require(ImageAttachments.pending(restoring: .pixel))
    composer.attach([image])
    composer.toggleLink("/repos/other")
    composer.submit()
    await settle()
    let sent = try #require(host.sent.first)
    // The bubble shows the whole body so the transcript can draw the link as a chip.
    #expect(sent.displayText == nil)
    #expect(sent.message == LinkedProjects.buildPreamble(paths: ["/repos/other"], message: "(see attached images)"))
    #expect(sent.images.count == 1)
    #expect(composer.linkedProjects.isEmpty)
    #expect(composer.images.isEmpty)
    #expect(preferences.decode(PreferenceKey.linkedProjects(agentId: "a1"), as: [String].self) == nil)
  }

  @Test("a picked element sends its context and crop; the bubble shows a chip instead")
  func pickedElement() async throws {
    let composer = model()
    composer.attach(PickedElement(source: .browser, title: "button.save", context: "[ctx]", crop: .pixel))
    #expect(composer.hasContent)
    composer.text = "make this red"
    composer.submit()
    await settle()
    let sent = try #require(host.sent.first)
    #expect(sent.message == "make this red\n\n[ctx]")
    #expect(sent.displayText == "make this red\n\n[Element: button.save]")
    #expect(sent.images.count == 1)
    #expect(composer.elements.isEmpty)
  }

  @Test("/plan toggles plan mode and /model sets or opens the picker, never reaching the CLI")
  func localCommands() async {
    let composer = model()
    composer.text = "/plan"
    composer.submit()
    composer.text = "/model opus"
    composer.submit()
    composer.text = "/model"
    composer.submit()
    await settle()
    #expect(host.modes == [.plan])
    #expect(host.models == ["opus"])
    #expect(composer.showingModelPicker)
    #expect(host.sent.isEmpty)
  }

  @Test("a local command with an image attached goes to the CLI as text")
  func localCommandWithImage() async throws {
    let composer = model()
    composer.attach([try #require(ImageAttachments.pending(restoring: .pixel))])
    composer.text = "/plan"
    composer.submit()
    await settle()
    #expect(host.sent.map(\.message) == ["/plan"])
    #expect(host.modes.isEmpty)
  }

  @Test("the desktop refuses input for a stopped agent; the phone doesn't")
  func stopped() async {
    let desk = model(status: .stopped)
    desk.text = "hello"
    desk.submit()
    let phone = model(status: .stopped, style: .phone)
    phone.text = "hello"
    phone.submit()
    await settle()
    #expect(!desk.isEnabled)
    #expect(host.sent.count == 1)
  }

  @Test("side questions need a conversation: not before the first message, nor in a start composer")
  func hasConversation() {
    let composer = model()
    #expect(!composer.hasConversation)
    host.messagesByAgent["a1"] = [RemoteMessage(id: "m1", role: .user, textBlocks: ["go"], toolCalls: [])]
    #expect(composer.hasConversation)
    #expect(!model(status: nil, starter: ComposerStarter(defaultMode: "auto") { _ in true }).hasConversation)
  }

  @Test("the draft's text, images and links come back on load")
  func draftRestore() async throws {
    let first = model()
    first.text = "half a thought"
    first.attach([try #require(ImageAttachments.pending(restoring: .pixel))])
    first.toggleLink("/repos/other")

    let second = model()
    await second.load()
    #expect(second.text == "half a thought")
    #expect(second.caret == "half a thought".utf16.count)
    #expect(second.images.map(\.attachment) == [.pixel])
    #expect(second.linkedProjects == ["/repos/other"])
    #expect(host.loadedCapabilities == ["a1"])
  }

  @Test("a start composer keeps its picks and hands them to the agent it starts")
  func starter() async {
    var started: [ComposerStart] = []
    let starter = ComposerStarter(defaultMode: "auto") { request in
      started.append(request)
      return true
    }
    let composer = model(status: nil, starter: starter)
    composer.setPermissionMode(.plan)
    composer.text = "/model sonnet"
    composer.submit()
    composer.text = "build it"
    composer.submit()
    await settle()
    #expect(host.modes.isEmpty)
    #expect(host.models.isEmpty)
    #expect(started.map(\.message) == ["build it"])
    #expect(started.first?.permissionMode == .plan)
    #expect(started.first?.model == "sonnet")
    #expect(composer.text.isEmpty)
    #expect(composer.permissionMode == .auto)
  }

  @Test("a redirect that needs text won't start from images alone")
  func redirectNeedsText() async throws {
    let redirect = ComposerStarter(defaultMode: "auto", needsText: true) { _ in true }
    let composer = model()
    composer.attach([try #require(ImageAttachments.pending(restoring: .pixel))])
    #expect(composer.canSend())
    #expect(!composer.canSend(redirect: redirect))
  }

  @Test("a redirect that isn't ready won't start; one that needs no content starts empty")
  func redirectReadiness() async {
    var started: [ComposerStart] = []
    let starter = ComposerStarter(defaultMode: "auto") { _ in true }
    let composer = model(status: nil, starter: starter)
    composer.text = "fix it"
    #expect(!composer.canSend(redirect: ComposerStarter(defaultMode: "auto", ready: false) { _ in true }))
    composer.text = ""
    let issues = ComposerStarter(defaultMode: "auto", needsContent: false) { request in
      started.append(request)
      return true
    }
    #expect(composer.canSend(redirect: issues))
    composer.submit(redirect: issues)
    await settle()
    #expect(started.map(\.message) == [""])
  }

  @Test("a runner's declared models replace the reported ones, hide effort, and ride the start")
  func runner() async {
    var started: [ComposerStart] = []
    let starter = ComposerStarter(defaultMode: "auto") { request in
      started.append(request)
      return true
    }
    let composer = model(status: nil, starter: starter)
    let json = #"{"id":"gw","display_name":"Gateway","is_custom":true,"models":[{"value":"m1","display_name":"M1"}]}"#
    let gateway = try? JSONDecoder().decode(RemoteRunner.self, from: Data(json.utf8))
    composer.setModel("opus")
    composer.setRunner(gateway)
    #expect(composer.models.map(\.value) == ["m1"])
    #expect(composer.modelLabel == "Default")
    #expect(composer.effortLevels.isEmpty)
    composer.text = "go"
    composer.submit()
    await settle()
    #expect(started.first?.runnerId == "gw")
    #expect(started.first?.model == nil)
  }

  @Test("a start picks its account, which rides the start; other runners get no account section")
  func startAccount() async throws {
    var started: [ComposerStart] = []
    let starter = ComposerStarter(defaultMode: "auto") { request in
      started.append(request)
      return true
    }
    host.claudeAccounts = try ["work", "side"].map { id in
      let json = #"{"id":"\#(id)","label":"\#(id)","needs_reauth":false,"rate_limited":false,"account_type":"claudeai"}"#
      return try JSONDecoder().decode(RemoteClaudeAccount.self, from: Data(json.utf8))
    }
    let composer = model(status: nil, starter: starter)
    #expect(composer.offersAccounts)
    #expect(composer.accountId == ComposerModel.followDefaultAccount)
    composer.setAccount("side")
    #expect(composer.accountId == "side")
    composer.text = "go"
    composer.submit()
    await settle()
    #expect(started.first?.accountId == "side")
    // Sent once: the next start follows the session again.
    #expect(composer.accountId == ComposerModel.followDefaultAccount)

    let json = #"{"id":"gw","display_name":"Gateway","is_custom":true,"models":[]}"#
    composer.setRunner(try JSONDecoder().decode(RemoteRunner.self, from: Data(json.utf8)))
    #expect(!composer.offersAccounts)
  }

  @Test("before a conversation the default is a choice; after it, the account the agent runs on is ticked")
  func accountChoice() async throws {
    host.claudeAccounts = try ["work", "side"].map { id in
      let json = #"{"id":"\#(id)","label":"\#(id)","needs_reauth":false,"rate_limited":false,"account_type":"claudeai"}"#
      return try JSONDecoder().decode(RemoteClaudeAccount.self, from: Data(json.utf8))
    }
    host.activeClaudeAccountId = "work"
    let composer = model()
    #expect(composer.offersFollowDefault)
    #expect(composer.checkedAccountId == ComposerModel.followDefaultAccount)

    host.messagesByAgent["a1"] = [RemoteMessage(id: "m1", role: .user, textBlocks: ["go"], toolCalls: [])]
    host.statusByAgent["a1"]?.accountId = "side"
    #expect(!composer.offersFollowDefault)
    #expect(composer.checkedAccountId == "side")
    #expect(composer.accountHint("side") == nil)
    composer.setAccount("side")
    await settle()
    #expect(host.pins.isEmpty)

    composer.setAccount("work")
    await settle()
    #expect(host.pins["s1"] == "work")
    #expect(composer.checkedAccountId == "work")
    #expect(composer.accountHint("work") == "After this turn")
    #expect(composer.accountHint("side") == nil)
    host.statusByAgent["a1"]?.accountId = "work"
    #expect(composer.accountHint("work") == nil)
  }

  @Test("a start the account picker was never touched leaves the session's pin alone")
  func startWithoutAccount() async {
    var started: [ComposerStart] = []
    let composer = model(status: nil, starter: ComposerStarter(defaultMode: "auto") { request in
      started.append(request)
      return true
    })
    composer.text = "go"
    composer.submit()
    await settle()
    #expect(started.first?.accountId == nil)
  }

  @Test("a picked runner drops the starter's default model, which belongs to the default runner")
  func runnerDropsDefaultModel() {
    let starter = ComposerStarter(defaultMode: "auto", defaultModel: "opus") { _ in true }
    let composer = model(status: nil, starter: starter)
    #expect(composer.pickedModel == "opus")
    let json = #"{"id":"gemini","display_name":"Gemini CLI","is_custom":false,"models":[]}"#
    composer.setRunner(try? JSONDecoder().decode(RemoteRunner.self, from: Data(json.utf8)))
    #expect(composer.pickedModel == nil)
    composer.setRunner(nil)
    #expect(composer.pickedModel == "opus")
  }

  @Test("an @ at the caret opens the menu; picking a file inserts it through the editor")
  func mention() async {
    let editor = FakeEditor()
    let composer = model(editor: editor)
    editor.composer = composer
    host.files = ["src/app.swift", "README.md"]
    await composer.load()
    composer.text = "see @app"
    composer.caret = 8
    #expect(composer.mentionItems.map(\.display) == ["app.swift"])
    composer.acceptMention(composer.mentionItems[0])
    #expect(composer.text == "see @src/app.swift ")
    #expect(editor.replacements == 1)
  }

  @Test("only the newest browse lookup lands")
  func browseRace() async {
    let composer = model()
    host.mentionDelay = { query in query == "src/" ? 20 : 0 }
    host.mentionEntries = ["src/": ["old.swift"], "lib/": ["new.swift"]]
    composer.text = "@src/"
    composer.caret = 5
    await settle()
    composer.text = "@lib/"
    composer.caret = 5
    try? await Task.sleep(for: .milliseconds(80))
    #expect(composer.mentionItems.map(\.display) == ["lib", "new.swift"])
  }

  @Test("Esc closes the menu until the text changes")
  func dismiss() {
    let composer = model()
    composer.text = "/"
    #expect(!composer.slashItems.isEmpty)
    #expect(composer.handle(.escape))
    #expect(composer.slashItems.isEmpty)
    composer.text = "/c"
    #expect(!composer.slashItems.isEmpty)
  }

  @Test("Return sends; ⇧Return passes through")
  func keys() async {
    let composer = model()
    composer.text = "go"
    #expect(!composer.handle(.returnKey(shift: true)))
    #expect(composer.handle(.returnKey(shift: false)))
    await settle()
    #expect(host.sent.map(\.message) == ["go"])
  }

  @Test("/usage-limits opens the limits panel without sending, and the next send closes it")
  func usageLimits() async {
    let composer = model()
    #expect(!composer.commands.contains { $0.name == "usage-limits" })
    host.usageLimits = ArgusProtocol.ClaudeUsageLimits(accounts: [
      .init(
        accountId: "a", label: "Work", status: .ok,
        windows: [.init(id: "five_hour", kind: .session, label: "Session", usedPercent: 40)], checkedAt: 1)
    ])
    #expect(composer.commands.contains { $0.name == "usage-limits" })
    composer.text = "/usage-limits"
    composer.submit()
    await settle()
    #expect(composer.showingUsageLimits)
    #expect(host.sent.isEmpty)
    #expect(composer.text.isEmpty)
    composer.text = "carry on"
    composer.submit()
    await settle()
    #expect(!composer.showingUsageLimits)
    #expect(host.sent.map(\.message) == ["carry on"])
  }

  @Test("/usage-limits goes to the agent when its runner has no limits")
  func usageLimitsUnoffered() async {
    let composer = model()
    composer.text = "/usage-limits"
    composer.submit()
    await settle()
    #expect(!composer.showingUsageLimits)
    #expect(host.sent.map(\.message) == ["/usage-limits"])
  }

  private func settle() async {
    for _ in 0..<10 { await Task.yield() }
  }
}

extension RemoteImageAttachment {
  /// A 1×1 PNG.
  fileprivate static let pixel = RemoteImageAttachment(
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    mediaType: "image/png")
}

extension RemoteAgentStatus {
  fileprivate static func fake(_ state: RemoteAgentState) -> RemoteAgentStatus {
    let json = #"{"agent_id":"a1","session_id":"s1","status":"\#(state.rawValue)"}"#
    return try! JSONDecoder().decode(RemoteAgentStatus.self, from: Data(json.utf8))
  }
}

@MainActor
private final class FakeEditor: ComposerEditor {
  weak var composer: ComposerModel?
  var replacements = 0
  var caret: Int { composer?.caret ?? 0 }

  func replace(with text: String, caret: Int?) {
    replacements += 1
    composer?.text = text
    composer?.caret = caret ?? text.utf16.count
  }

  func reset() { composer?.text = "" }
  func restore(_ text: String) { composer?.text = text }
  func focus() {}
}

@MainActor
final class FakeComposerHost: ComposerHost {
  struct Sent {
    let message: String
    let displayText: String?
    let images: [RemoteImageAttachment]
  }

  var statusByAgent: [String: RemoteAgentStatus] = [:]
  var capabilitiesByAgent: [String: RemoteAgentCapabilities] = [:]
  var startOptionsBySession: [String: RemoteAgentCapabilities] = [:]
  var followUpsByAgent: [String: [String]] = [:]
  var effortByAgent: [String: String] = [:]
  var claudeAccounts: [RemoteClaudeAccount]? = []
  var activeClaudeAccountId: String?
  var projects: [RemoteProject] = []
  var sessionsByRepo: [String: [RemoteSession]] = [:]
  var usageLimits: ArgusProtocol.ClaudeUsageLimits?

  var files: [String] = []
  var mentionEntries: [String: [String]] = [:]
  var mentionDelay: (String) -> Int = { _ in 0 }
  private(set) var sent: [Sent] = []
  private(set) var queued: [Sent] = []
  private(set) var modes: [RemotePermissionMode] = []
  private(set) var models: [String] = []
  private(set) var loadedCapabilities: [String] = []

  private(set) var pins: [String: String] = [:]
  func claudeAccountId(forSessionId id: String) -> String? { pins[id] }
  func repoRoot(forSessionId id: String) -> String? { nil }
  var messagesByAgent: [String: [RemoteMessage]] = [:]
  func visibleMessages(for key: String) -> [RemoteMessage] { messagesByAgent[key] ?? [] }
  func lastKnownModels(runnerId: String?) -> [RemoteModelInfo] { [] }

  func sendMessage(
    agentId: String, message: String, images: [RemoteImageAttachment], displayText: String?, isRetry: Bool
  ) async {
    sent.append(Sent(message: message, displayText: displayText, images: images))
  }

  func queueMessage(agentId: String, message: String, images: [RemoteImageAttachment], displayText: String) async {
    queued.append(Sent(message: message, displayText: displayText, images: images))
  }

  func interrupt(agentId: String) async {}
  func setModel(agentId: String, model: String) async { models.append(model) }
  func setPermissionMode(agentId: String, mode: RemotePermissionMode) async { modes.append(mode) }
  func setEffort(agentId: String, level: String?) async {}
  func setSessionClaudeAccount(sessionId: String, accountId: String?, agentId: String) async {
    pins[sessionId] = accountId
  }
  func loadCapabilities(agentId: String) async { loadedCapabilities.append(agentId) }
  func loadQueue(agentId: String) async {}
  func loadStartOptions(sessionId: String, runnerId: String?) async {}
  func loadSessions(repoRoot: String) async {}
  func refreshClaudeAccounts() async {}
  func loadUsageLimits(refresh: Bool) async {}
  func listFiles(sessionId: String) async -> [String] { files }

  func resolveMentionPath(sessionId: String, query: String) async -> RemoteMentionPathResult? {
    let delay = mentionDelay(query)
    if delay > 0 { try? await Task.sleep(for: .milliseconds(delay)) }
    let names = mentionEntries[query] ?? []
    let json = #"{"resolved_path":"\#(query)","entries":["#
      + names.map { #"{"name":"\#($0)","is_dir":false}"# }.joined(separator: ",") + "]}"
    return try? JSONDecoder().decode(RemoteMentionPathResult.self, from: Data(json.utf8))
  }

  func hostPaths(forDropped urls: [URL], sessionId: String?) async -> HostStore.DroppedFiles {
    HostStore.DroppedFiles(paths: urls.map(\.path), errors: [])
  }
}
