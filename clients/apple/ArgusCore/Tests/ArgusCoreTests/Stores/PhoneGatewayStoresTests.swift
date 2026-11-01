import ArgusCore
import Foundation
import Testing

/// The phone reaches proposals and automations through typed gateway methods.
@MainActor
struct PhoneGatewayStoresTests {
  private static let proposal = #"""
    {"id":"p1","automation_id":"a1","automation_name":"Triage","title":"Fix it","summary":"s",
     "rationale":"r","confidence":0.8,"cta":null,"status":"pending","project":null,
     "source_label":null,"source_url":null,"session_id":null,"agent_id":null,
     "start_stage":null,"start_error":null,"created_at":1,"revision_request":"smaller"}
    """#

  @Test func asksForARevisionAndKeepsTheRecord() async {
    let backend = RecordingBackend(kind: .gateway)
    backend.reply("proposals.request_revision", #"{"proposal":\#(Self.proposal),"run_started":true}"#)
    backend.reply("proposals.list", #"{"proposals":[]}"#)
    let host = HostStore()
    await host.attach(backend)
    let store = ProposalsStore(host: host)

    #expect(await store.requestRevision(id: "p1", note: "smaller") == true)
    #expect(backend.calls("proposals.request_revision").first?.params
      == .object(["proposal_id": .string("p1"), "note": .string("smaller")]))
    #expect(store.detailById["p1"]?.revisionRequest == "smaller")
  }

  @Test func startsWithANote() async {
    let backend = RecordingBackend(kind: .gateway)
    backend.reply("proposals.accept", #"{"proposal":\#(Self.proposal),"agent_id":"ag1","session_id":"s1"}"#)
    let host = HostStore()
    await host.attach(backend)
    let store = ProposalsStore(host: host)

    #expect(await store.accept(id: "p1", note: "  keep it small ") == "ag1")
    #expect(backend.calls("proposals.accept").first?.params
      == .object(["proposal_id": .string("p1"), "note": .string("keep it small")]))
  }

  @Test func deletesARunAndReadsTheTrackRecord() async {
    let backend = RecordingBackend(kind: .gateway)
    backend.reply("automations.delete_run", #"{"accepted":true}"#)
    backend.reply("automations.calibration", #"""
      {"automation_id":"a1","sample":2,"accepted":1,"auto_started":0,"dismissed":1,"pending":0,
       "resolved":0,"superseded":0,"withdrawn":0,"merged":0,"abandoned":0,"reverted":0,
       "acceptance_rate":0.5,"dismissals":[{"title":"t","reason":"no"}],"accepted_notes":[]}
      """#)
    let host = HostStore()
    await host.attach(backend)
    let store = AutomationsStore(host: host)

    #expect(await store.deleteRunOverGateway(id: "r1"))
    await store.loadCalibrationOverGateway(automationId: "a1")
    #expect(store.calibrationById["a1"]?.acceptanceRate == 0.5)
  }

  private static func run(_ id: String, quick: Bool) -> String {
    #"{"id":"\#(id)","automation_id":"a1","automation_name":"A","is_quick":\#(quick),"#
      + #""status":"succeeded","trigger_reason":"manual","started_at":1,"unread_report":false}"#
  }

  @Test func readsQuickRunHistory() async {
    let backend = RecordingBackend(kind: .gateway)
    backend.reply("automations.scratch_runs", #"{"runs":[\#(Self.run("q1", quick: true))]}"#)
    let host = HostStore()
    await host.attach(backend)
    let store = AutomationsStore(host: host)

    await store.loadQuickRunsOverGateway()

    #expect(store.quickRuns?.map(\.id) == ["q1"])
  }

  @Test func anOlderComputerFallsBackToTheRecentQuickRuns() async {
    let backend = RecordingBackend(kind: .gateway)
    backend.fail("automations.scratch_runs")
    backend.reply(
      "automations.runs", #"{"runs":[\#(Self.run("r1", quick: false)),\#(Self.run("q1", quick: true))]}"#)
    let host = HostStore()
    await host.attach(backend)
    let store = AutomationsStore(host: host)

    await store.loadQuickRunsOverGateway()

    #expect(store.quickRuns?.map(\.id) == ["q1"])
  }

  @Test func clearingTheAutonomyCapSendsNull() async {
    let backend = RecordingBackend(kind: .gateway)
    backend.reply("automations.set_default_autonomy", #"{"autonomy":null}"#)
    let host = HostStore()
    await host.attach(backend)
    let store = AutomationsStore(host: host)

    #expect(await store.setDefaultAutonomy(nil))
    #expect(backend.calls("automations.set_default_autonomy").first?.params
      == .object(["autonomy": .null]))
  }

  @Test func popsAStashAndAmends() async {
    let backend = RecordingBackend(kind: .gateway)
    backend.reply("sessions.stash_apply", #"{"output":"Dropped stash@{1}"}"#)
    backend.reply("sessions.commit", #"{"output":"ok"}"#)
    let host = HostStore()
    await host.attach(backend)

    #expect(await host.applyStash(sessionId: "s1", index: 1, drop: true) == "Dropped stash@{1}")
    #expect(backend.calls("sessions.stash_apply").first?.params
      == .object(["session_id": .string("s1"), "index": .number(1), "drop": .bool(true)]))
    _ = await host.commit(sessionId: "s1", message: "m", amend: true)
    #expect(backend.calls("sessions.commit").first?.params["amend"] == .bool(true))
  }
}
