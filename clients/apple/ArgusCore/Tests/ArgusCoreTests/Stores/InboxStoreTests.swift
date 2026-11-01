import ArgusCore
import ArgusKit
import Foundation
import Testing

@MainActor
@Suite("Inbox")
struct InboxStoreTests {
  private static let now: Double = 1_800_000_000_000
  private static let hour: Double = 60 * 60 * 1000

  static func proposal(
    _ id: String, _ status: String, created: Double = now, extra: String = ""
  ) -> String {
    #"{"id":"\#(id)","run_id":"r1","automation_id":"a1","title":"T \#(id)","summary":"S","#
      + #""confidence":0.9,"rationale":"","recommended_action":"start_session","#
      + #""status":"\#(status)","created_at":\#(created)\#(extra)}"#
  }

  static func run(
    _ id: String, _ status: String, started: Double = now, read: Bool = false,
    report: String? = nil
  ) -> String {
    let markdown = report.map { #","report_markdown":"\#($0)""# } ?? ""
    return #"{"id":"\#(id)","automation_id":"a1","status":"\#(status)","trigger_reason":"manual","#
      + #""started_at":\#(started),"report_read":\#(read),"feedback":[]\#(markdown)}"#
  }

  private static func decode<T: Decodable>(_ json: String, as _: T.Type) throws -> T {
    try ProtocolCodec.decoder.decode(T.self, from: Data(json.utf8))
  }

  @Test("groups proposals and runs by what you would do about them")
  func grouping() throws {
    let proposals = try Self.decode(
      "[" + [
        Self.proposal("pending", "pending"),
        Self.proposal("live", "accepted", extra: #","session_id":"s1""#),
        Self.proposal("merged", "auto_started", extra: #","session_id":"gone""#),
        Self.proposal("fresh", "withdrawn", extra: #","cleared_at":\#(Self.now - Self.hour)"#),
        Self.proposal("stale", "superseded", extra: #","cleared_at":\#(Self.now - 25 * Self.hour)"#),
        Self.proposal("no", "dismissed"),
      ].joined(separator: ",") + "]",
      as: [ArgusProtocol.Proposal].self)
    let runs = try Self.decode(
      "[" + [
        Self.run("failed", "failed"),
        Self.run("old-failure", "failed", started: Self.now - 25 * Self.hour),
        Self.run("read-failure", "failed", read: true),
        Self.run("report", "succeeded", report: "# Weekly\\nbody"),
        Self.run("read-report", "succeeded", read: true, report: "x"),
        Self.run("running", "running", report: "partial"),
        Self.run("failed-with-report", "failed", report: "why"),
      ].joined(separator: ",") + "]",
      as: [ArgusProtocol.AutomationRun].self)

    let items = InboxItems(proposals: proposals, runs: runs, sessionIds: ["s1"], now: Self.now)
    #expect(items.pending.map(\.id) == ["pending"])
    #expect(items.started.map(\.id) == ["live"])
    #expect(items.cleared.map(\.id) == ["fresh"])
    #expect(items.failed.map(\.id) == ["failed", "failed-with-report"])
    #expect(items.reports.map(\.id) == ["report"])
    #expect(items.reports.first?.reportPreview == "Weekly")
    #expect(items.actionCount == 4)
    #expect(!items.isEmpty)

    let home = items.needsYou(maxProposals: 2, maxFailed: 1)
    #expect(home.proposals.map(\.id) == ["pending"])
    #expect(home.failed.map(\.id) == ["failed"])
    #expect(home.waiting == 3)
    #expect(home.hidden == 1)
  }

  static func remoteProposal(_ id: String, _ status: String, extra: String = "") -> String {
    #"{"id":"\#(id)","automation_id":"a1","automation_name":"A","title":"T","summary":"S","#
      + #""rationale":"","confidence":0.9,"cta":null,"status":"\#(status)","project":null,"#
      + #""source_label":null,"source_url":null,"agent_id":null,"#
      + #""start_stage":null,"start_error":null,"created_at":\#(now)\#(extra)}"#
  }

  static func remoteRun(
    _ id: String, _ status: String, started: Double = now, unread: Bool = false,
    read: String = ""
  ) -> String {
    #"{"id":"\#(id)","automation_id":"a1","automation_name":"A","is_quick":false,"#
      + #""status":"\#(status)","trigger_reason":"manual","started_at":\#(started),"#
      + #""unread_report":\#(unread)\#(read)}"#
  }

  @Test("the phone's wire shapes group the same way")
  func remoteGrouping() throws {
    let proposals = try Self.decode(
      "[" + [
        Self.remoteProposal("pending", "pending"),
        Self.remoteProposal("live", "accepted", extra: #","session_id":"s1""#),
        Self.remoteProposal("merged", "auto_started", extra: #","session_id":"gone""#),
        Self.remoteProposal("fresh", "withdrawn", extra: #","cleared_at":\#(Self.now - Self.hour)"#),
        Self.remoteProposal("stale", "superseded", extra: #","cleared_at":\#(Self.now - 25 * Self.hour)"#),
        Self.remoteProposal("no", "dismissed"),
      ].joined(separator: ",") + "]",
      as: [RemoteProposal].self)
    let runs = try Self.decode(
      "[" + [
        Self.remoteRun("failed", "failed"),
        Self.remoteRun("old-failure", "failed", started: Self.now - 25 * Self.hour),
        Self.remoteRun("read-failure", "failed", read: #","report_read":true"#),
        Self.remoteRun("report", "succeeded", unread: true),
        Self.remoteRun("read-report", "succeeded"),
        Self.remoteRun("running", "running", unread: true),
        Self.remoteRun("failed-with-report", "failed", unread: true),
      ].joined(separator: ",") + "]",
      as: [RemoteAutomationRun].self)

    let items = RemoteInboxItems(proposals: proposals, runs: runs, sessionIds: ["s1"], now: Self.now)
    #expect(items.pending.map(\.id) == ["pending"])
    #expect(items.started.map(\.id) == ["live"])
    #expect(items.cleared.map(\.id) == ["fresh"])
    #expect(items.failed.map(\.id) == ["failed", "failed-with-report"])
    #expect(items.reports.map(\.id) == ["report"])
    #expect(items.actionCount == 4)
  }

  @Test("a phone row previews the report, and an older computer's the trigger")
  func remoteSummary() throws {
    let runs = try Self.decode(
      "[" + [
        Self.remoteRun("new", "succeeded", unread: true, read: #","report_preview":"Nothing on fire.""#),
        Self.remoteRun("old", "succeeded", unread: true),
        Self.remoteRun("empty", "succeeded", read: #","report_preview":null"#),
      ].joined(separator: ",") + "]",
      as: [RemoteAutomationRun].self)
    #expect(runs.map(\.summary) == ["Nothing on fire.", "manual", "manual"])
  }

  @Test("proposals:changed replaces the list and a run event upserts one run")
  func liveUpdates() async throws {
    let host = HostStore()
    let backend = FakeBackend()
    backend.reply(command: "proposals_list", "[\(Self.proposal("p1", "pending"))]")
    backend.reply(command: "automation_runs_list", "[\(Self.run("r1", "running"))]")
    await host.attach(backend)
    let inbox = InboxStore(host: host)
    await inbox.refresh()
    #expect(inbox.proposals.map(\.id) == ["p1"])

    let list = try Self.decode(
      "[\(Self.proposal("old", "pending", created: 1)),\(Self.proposal("new", "pending", created: 2))]",
      as: JSONValue.self)
    #expect(inbox.ipc(channel: "proposals:changed", args: [list]))
    #expect(inbox.proposals.map(\.id) == ["new", "old"])

    let finished = try Self.decode(Self.run("r1", "succeeded", report: "done"), as: JSONValue.self)
    inbox.ipc(channel: "automation_run:changed", args: [finished])
    #expect(inbox.runs.map(\.status) == [.succeeded])
    let newer = try Self.decode(Self.run("r2", "queued", started: Self.now + 1), as: JSONValue.self)
    inbox.ipc(channel: "automation_run:changed", args: [newer])
    #expect(inbox.runs.map(\.id) == ["r2", "r1"])
    #expect(!inbox.ipc(channel: "sessions:changed", args: []))
  }

  @Test("a refused start is kept for the card; a dismissal lands on the record")
  func start() async throws {
    let host = HostStore()
    let backend = FakeBackend()
    var tracked: [StoreEvent] = []
    host.hooks.track = { tracked.append($0) }
    await host.attach(backend)
    let inbox = InboxStore(host: host)

    backend.fail(command: "proposal_accept")
    #expect(await inbox.start(id: "p1", note: "use the new API") == nil)
    #expect(inbox.refusals["p1"] != nil)
    #expect(inbox.starting.isEmpty)

    backend.reply(
      command: "proposal_dismiss", Self.proposal("p1", "dismissed", extra: #","dismissed_reason":"no""#))
    #expect(await inbox.dismiss(id: "p1", reason: "no"))
    #expect(inbox.proposal(id: "p1")?.dismissedReason == "no")
    #expect(tracked == [.proposalHandled(action: .dismiss)])
  }

  @Test("deleting a run drops it and its report")
  func deleteRun() async throws {
    let host = HostStore()
    let backend = FakeBackend()
    backend.reply(.automationsRuns, #"{"runs":[{"id":"r1","automation_id":"a1","automation_name":"A","is_quick":false,"status":"failed","trigger_reason":"manual","started_at":1,"unread_report":false}]}"#)
    backend.reply(.automationsList, #"{"automations":[]}"#)
    backend.reply(command: "automation_run_delete", "null")
    await host.attach(backend)
    let automations = AutomationsStore(host: host)
    await automations.refresh()
    #expect(automations.runs.map(\.id) == ["r1"])
    #expect(await automations.deleteRun(id: "r1"))
    #expect(automations.runs.isEmpty)
  }
}
