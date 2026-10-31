import ArgusCore
import ArgusKit
import Foundation
import Testing

/// The start composer's and start sheet's shared send: spawn, effort, first message, worktrees.
@MainActor
@Suite("Starting an agent")
struct StartAgentTests {
  private static let agent = #"{"agent_id":"a-new","session_id":"s-1","status":"idle","created_at":1}"#
  private static let image = RemoteImageAttachment(data: "aGk=", mediaType: "image/png")

  private static func session(status: String) -> String {
    #"{"session":{"id":"s-2","kind":"worktree","branch":"fix","description":"","path":"/r/wt","repo_root":"/r","status":"\#(status)"}}"#
  }

  private func store(_ kind: HostBackendKind) async -> (HostStore, RecordingBackend) {
    let backend = RecordingBackend(kind: kind)
    backend.reply("agents.spawn", #"{"agent":\#(Self.agent)}"#)
    backend.reply("agents.list", #"{"agents":[\#(Self.agent)]}"#)
    backend.reply("start_agent", #"{"agent_id":"a-trusted","created_at":1,"runner_id":"claude-code","session_id":"s-1","status":"idle"}"#)
    let store = HostStore()
    await store.attach(backend)
    return (store, backend)
  }

  @Test("spawns with the default mode, sets effort, then sends the images")
  func startsInSession() async {
    let (store, backend) = await store(.gateway)
    var opened: (String, String)?
    let request = ComposerStart(message: "fix it", displayText: "fix it", images: [Self.image], effort: "high")

    let id = await store.startAgent(
      inSession: "s-1", with: request, defaults: AgentStartDefaults(mode: "plan", model: "opus")
    ) { opened = ($0, $1) }

    #expect(id == "a-new")
    #expect(opened?.0 == "a-new" && opened?.1 == "s-1")
    let spawn = backend.calls("agents.spawn").first?.params
    #expect(spawn?["permission_mode"] == .string("plan"))
    #expect(spawn?["model"] == .string("opus"))
    #expect(backend.calls("agents.set_effort").first?.params["level"] == .string("high"))
    #expect(backend.calls("agents.send").first?.params["images"]?.arrayValue?.count == 1)
  }

  @Test("an empty request starts the agent without a message")
  func emptyStartSendsNothing() async {
    let (store, backend) = await store(.gateway)
    _ = await store.startAgent(
      inSession: "s-1", with: ComposerStart(message: "", displayText: ""), defaults: AgentStartDefaults())
    #expect(backend.calls("agents.send").isEmpty)
  }

  @Test("trusted goes through the admin start on the computer itself only")
  func trustedIsLocalOnly() async {
    let (local, localBackend) = await store(.local)
    #expect(await local.startAgent(sessionId: "s-1", mode: "trusted", model: nil) == "a-trusted")
    #expect(localBackend.calls("agents.spawn").isEmpty)

    let (phone, phoneBackend) = await store(.gateway)
    #expect(await phone.startAgent(sessionId: "s-1", mode: "trusted", model: nil) == "a-new")
    #expect(phoneBackend.calls("start_agent").isEmpty)
    #expect(phoneBackend.calls("agents.spawn").first?.params["permission_mode"] == nil)
  }

  @Test("text alone rides the new worktree's prompt")
  func hostStartsTextOnly() async {
    let (store, backend) = await store(.gateway)
    backend.reply("sessions.create", Self.session(status: "initializing"))

    let session = await store.startInNewWorktree(
      repoRoot: "/r", baseBranch: "main", request: ComposerStart(message: "fix it", displayText: "fix it"),
      defaults: AgentStartDefaults(mode: "plan"))

    #expect(session?.id == "s-2")
    let create = backend.calls("sessions.create").first?.params
    #expect(create?["prompt"] == .string("fix it"))
    #expect(create?["base_branch"] == .string("main"))
    #expect(create?["permission_mode"] == .string("plan"))
    #expect(backend.calls("agents.spawn").isEmpty)
  }

  @Test("images wait for setup, then start the agent here")
  func imagesStartWhenReady() async {
    let (store, backend) = await store(.gateway)
    backend.reply("sessions.create", Self.session(status: "ready"))
    var opened: String?

    _ = await store.startInNewWorktree(
      repoRoot: "/r", baseBranch: nil, existingBranch: "fix",
      request: ComposerStart(message: "look", displayText: "look", images: [Self.image]),
      defaults: AgentStartDefaults()
    ) { _, session in opened = session }

    let create = backend.calls("sessions.create").first?.params
    #expect(create?["prompt"] == nil)
    #expect(create?["use_existing_branch"] == .bool(true))
    #expect(await eventually { !backend.calls("agents.send").isEmpty })
    #expect(opened == "s-2")
  }

  @Test("the phone preselects a base from the gateway's read")
  func basePickerOverGateway() async {
    let (store, backend) = await store(.gateway)
    backend.reply(
      "projects.base_branches",
      #"{"local":["feature","main"],"origin_refs":["origin/main","origin/develop"],"protected_branches":[],"default_base_branch":"develop"}"#
    )
    let picker = BaseBranchPicker()

    await picker.load(repoRoot: "/r", projectRootBranch: "main", store: store)

    #expect(picker.base == "origin/develop")
    #expect(picker.options == ["feature", "main", "origin/main", "origin/develop"])
    #expect(backend.calls("list_all_branches").isEmpty)
  }
}
