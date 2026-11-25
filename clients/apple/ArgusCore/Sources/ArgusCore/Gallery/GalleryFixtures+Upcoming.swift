import ArgusKit
import Foundation

extension GalleryFixtures {
  /// The Upcoming screen: a dozen next runs, one held up by each thing a run
  /// can wait on, and two paused.
  static func upcomingRecords(empty: Bool) -> [[String: Any]] {
    guard !empty else { return [] }
    let now = Date().timeIntervalSince1970 * 1000
    func run(
      _ id: String, _ name: String, inMinutes: Double, teammate: String? = nil, once: Bool = false,
      waiting: String? = nil, untilMinutes: Double? = nil
    ) -> [String: Any] {
      [
        "automation_id": id, "name": name, "teammate_id": teammate.map { _ in "t-\(id)" } as Any,
        "teammate_name": teammate as Any, "trigger_kind": once ? "once" : "schedule",
        "next_run_at": now + inMinutes * 60_000, "waiting": waiting as Any,
        "waiting_until": untilMinutes.map { now + $0 * 60_000 } as Any,
      ]
    }
    return [
      run("shepherd", "PR shepherd", inMinutes: 6, teammate: "CI Fixer", waiting: "overlap"),
      run("triage", "Triage new issues", inMinutes: 14),
      run("deps", "Bump dependencies", inMinutes: 38, waiting: "approval"),
      run("red-ci", "Fix my red CI", inMinutes: 52, teammate: "CI Fixer", waiting: "limit", untilMinutes: 95),
      run("standup", "Morning standup notes", inMinutes: 60 * 9, teammate: "Standup"),
      run("flaky", "Quarantine flaky tests", inMinutes: 60 * 11),
      run("release", "Cut the release branch", inMinutes: 60 * 20, once: true),
      run("changelog", "Draft the changelog", inMinutes: 60 * 26, teammate: "Release Shepherd"),
      run("a11y", "Accessibility sweep", inMinutes: 60 * 30),
      run("docs", "Docs link checker", inMinutes: 60 * 33, waiting: "paused"),
      run("perf", "Bundle size watch", inMinutes: 60 * 50, teammate: "Perf Hawk", waiting: "paused"),
      run("weekly", "Weekly digest", inMinutes: 60 * 24 * 5),
    ]
  }
}
