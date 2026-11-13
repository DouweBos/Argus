import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

private func session(_ id: String, extra: [String: Any] = [:]) -> RemoteSession {
  var json: [String: Any] = ["id": id, "repo_root": "/r", "kind": "worktree", "branch": "b-\(id)", "status": "ready"]
  json.merge(extra) { $1 }
  return try! JSONDecoder().decode(RemoteSession.self, from: JSONSerialization.data(withJSONObject: json))
}

private func agent(_ session: String, status: String = "idle", awaiting: String? = nil) -> RemoteAgentStatus {
  var json: [String: Any] = ["agent_id": "a-\(session)", "session_id": session, "status": status]
  json["awaiting"] = awaiting
  return try! JSONDecoder().decode(RemoteAgentStatus.self, from: JSONSerialization.data(withJSONObject: json))
}

private let now = Date(timeIntervalSince1970: 1_700_000_000)
private func pr(_ state: String) -> [String: Any] { ["number": 1, "state": state, "url": "u"] }

@Suite("Session triage")
struct SessionTriageTests {
  @Test func sortsNeedsYouWorkingIdleAndFoldsTheRest() {
    let sessions = [
      session("idle"),
      session("merged", extra: ["pull_request": pr("merged")]),
      session("running"),
      session("asking"),
      session("unread", extra: ["unread": true]),
      session("snoozed", extra: ["snoozed_until": (now.timeIntervalSince1970 + 60) * 1000]),
      session("watched", extra: ["pull_request": pr("open"), "pull_request_watched": true]),
    ]
    let agents: [String: [RemoteAgentStatus]] = [
      "running": [agent("running", status: "running")],
      "asking": [agent("asking", status: "requires_action", awaiting: "question")],
    ]
    let triage = SessionTriage(sessions, now: now) { agents[$0.id] ?? [] }

    #expect(triage.needsYou.map(\.id) == ["asking", "unread"])
    #expect(triage.active.map(\.id) == ["running", "watched", "idle"])
    #expect(triage.done.map(\.id) == ["merged"])
    #expect(triage.snoozed.map(\.id) == ["snoozed"])
  }

  @Test func aCompareRunSortsAsItsMostUrgentSlot() {
    func slot(_ id: String, _ n: Int, _ extra: [String: Any] = [:]) -> RemoteSession {
      session(id, extra: extra.merging(["compare_group": ["id": "g", "slot": n]]) { $1 })
    }
    let asking = [slot("x", 0), slot("y", 1, ["pull_request": pr("merged")]), slot("z", 2), session("other")]
    let triage = SessionTriage(asking, now: now) {
      $0.id == "z" ? [agent("z", status: "requires_action", awaiting: "plan")] : []
    }
    #expect(triage.needsYou.map(\.id) == ["x", "y", "z"])
    #expect(triage.active.map(\.id) == ["other"])

    let settled = [slot("x", 0, ["pull_request": pr("merged")]), slot("y", 1, ["settled": true])]
    #expect(SessionTriage(settled, now: now) { _ in [] }.done.map(\.id) == ["x", "y"])
  }

  @Test func aManualMarkBeatsThePullRequest() {
    #expect(session("a", extra: ["pull_request": pr("merged"), "settled": false]).isDone == false)
    #expect(session("b", extra: ["pull_request": pr("open"), "settled": true]).isDone)
    #expect(session("c", extra: ["pull_request": pr("closed")]).isDone)
  }

  @Test func needingYouOutranksASnoozeAndDone() {
    let s = session("s", extra: ["settled": true, "snoozed_until": (now.timeIntervalSince1970 + 60) * 1000])
    let activity = SessionActivity(session: s, agents: [agent("s", status: "requires_action", awaiting: "permission")])
    #expect(activity.attention(now: now) == .needsYou)
  }

  @Test func aSnoozeInThePastIsOver() {
    let s = session("s", extra: ["snoozed_until": (now.timeIntervalSince1970 - 60) * 1000])
    #expect(SessionActivity(session: s, agents: []).attention(now: now) == .idle)
  }

  @Test func presetsLandInTheFuture() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    // Tuesday 14 November 2023, 22:13 UTC.
    let late = now
    #expect(SnoozePreset.thisEvening.date(from: late, calendar: calendar) == nil)
    let tomorrow = SnoozePreset.tomorrow.date(from: late, calendar: calendar)!
    #expect(calendar.component(.hour, from: tomorrow) == 9)
    #expect(tomorrow > late)
    let monday = SnoozePreset.nextWeek.date(from: late, calendar: calendar)!
    #expect(calendar.component(.weekday, from: monday) == 2)
    #expect(SnoozePreset.oneHour.date(from: late, calendar: calendar) == late.addingTimeInterval(3600))
  }
}

@Suite("Session group triage")
struct SessionGroupTriageTests {
  @Test func keepsTheRootOnTopAndNeverFoldsIt() {
    let root = session("root", extra: ["kind": "project_root", "settled": true])
    let merged = session("merged", extra: ["pull_request": pr("merged")])
    let busy = session("busy")
    let groups = [root, merged, busy].map {
      SessionGroup(id: $0.id, label: $0.branch, session: $0, agents: $0.id == "busy" ? [agent("busy", status: "running")] : [])
    }
    let triage = SessionGroupTriage(groups, now: now)
    #expect(triage.active.map(\.id) == ["root", "busy"])
    #expect(triage.done.map(\.id) == ["merged"])
    #expect(triage.foldedLabel == "1 done")
  }
}
