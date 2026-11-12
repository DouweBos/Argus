#if DEBUG
  import ArgusKit
  import SwiftUI

  /// The agents' Live Activity on the Lock Screen. iOS only: the Mac has no Live Activities.
  enum LiveActivityStories {
    static var all: [GalleryStory] {
      [
        story("live-activity/working", AgentActivitySnapshot(agents: [waiting, working, failed], more: 2)),
        story("live-activity/done", AgentActivitySnapshot(agents: [done, failed])),
        story("live-activity/sealed", nil),
        story("live-activity/watch-only", AgentActivitySnapshot(agents: [waiting, working]), canRespond: false),
      ]
    }

    private static func story(
      _ id: String, _ snapshot: AgentActivitySnapshot?, canRespond: Bool = true
    ) -> GalleryStory {
      GalleryStory(id, screen: false, chrome: false) {
        AgentActivityCard(
          hostId: "studio", hostName: "Mac Studio", canRespond: canRespond, state: state(snapshot), isStale: false
        ) { _, _ in
          Button {} label: { Text("Deny").frame(maxWidth: .infinity) }.tint(.red).buttonStyle(.borderedProminent)
          Button {} label: { Text("Approve").frame(maxWidth: .infinity) }.tint(.green).buttonStyle(.borderedProminent)
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22))
        .padding()
      }
    }

    /// A pushed update this phone couldn't open shows only its phase.
    private static func state(_ snapshot: AgentActivitySnapshot?) -> AgentActivityState {
      if let snapshot { return AgentActivityState(snapshot: snapshot) }
      let json = #"{"p":"working","e":"c2VhbGVk","t":0}"#
      return try! JSONDecoder().decode(AgentActivityState.self, from: Data(json.utf8))
    }

    private static let now = Date()
    private static let waiting = AgentActivityAgent(
      id: "a1", sessionId: "s1", title: "Fix flaky merge test", project: "Argus", state: .needsYou,
      startedAt: now.addingTimeInterval(-754), step: "Bash pnpm test",
      prompt: .init(toolUseId: "t1", summary: "Bash git push --force-with-lease origin fix-merge"))
    private static let working = AgentActivityAgent(
      id: "a2", sessionId: "s2", title: "Live Activity for running agents", project: "Argus", state: .working,
      startedAt: now.addingTimeInterval(-1_892), step: "Edit AgentActivities.swift")
    private static let failed = AgentActivityAgent(
      id: "a3", sessionId: "s3", title: "Bump Vite to 7.2", project: "houwert.dev", state: .failed,
      startedAt: now.addingTimeInterval(-600), endedAt: now.addingTimeInterval(-120))
    private static let done = AgentActivityAgent(
      id: "a4", sessionId: "s4", title: "Gallery stories for sessions", project: "Argus", state: .done,
      startedAt: now.addingTimeInterval(-2_400), endedAt: now.addingTimeInterval(-300))
  }
#endif
