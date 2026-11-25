#if DEBUG
  import ArgusCore
  import ArgusKit
  import SwiftUI

  /// The command palette over a dozen projects: chats live and saved, terminals and runs, open files.
  enum PaletteStories {
    static var all: [GalleryStory] {
      [
        story("palette/jumps/search", query: "onboard"),
        story("palette/jumps/terminals", query: "server"),
        story("palette/switcher", switcher: true),
        story("palette/switcher/chats", query: "notar", switcher: true),
      ]
    }

    private static func story(_ id: String, query: String = "", switcher: Bool = false) -> GalleryStory {
      GalleryStory(
        id, size: CGSize(width: 680, height: 0), fixtures: fixtures,
        setup: { stage in
          await HomeStories.load(stage)
          stage.model.navigate(.session(id: "s-long", agentId: "a-perm"))
          stage.model.terminals.galleryFill(terminals)
          for path in ["README.md", "packages/host/src/boot.ts", "clients/apple/ArgusDesktop/Onboarding/Welcome.swift"] {
            stage.model.code.session("s-long").tabs.open(path, preview: false)
          }
          stage.model.code.session("s-pr").tabs.open("packages/host/src/services/remote/gateway.ts", preview: false)
          await BuiltinPalette.loadSavedChats(stage.model)
          if switcher { stage.model.palette.present(switcher: true) }
        }
      ) {
        CommandPaletteView(query: query).padding(40)
      }
    }

    private static func ago(_ minutes: Double) -> Double { (Date().timeIntervalSince1970 - minutes * 60) * 1000 }

    private static func saved(_ id: String, branch: String, title: String, minutes: Double) -> [String: Any] {
      [
        "history_id": id, "runner_session_id": "r-\(id)", "title": title, "branch": branch, "message_count": 14,
        "started_at": ago(minutes + 40), "ended_at": ago(minutes),
      ]
    }

    private static var fixtures: [String: String] {
      var fixtures = GalleryFixtures.home
      fixtures["\(RemoteMethod.agentsStopped.rawValue)?repo_root=\(GalleryFixtures.argusRoot)"] = GalleryJSON.encode([
        "agents": [
          saved(
            "h1", branch: "douwe/rework-the-onboarding-flow-for-new-machines",
            title: "Sketch the onboarding steps for a new machine", minutes: 60 * 3),
          saved("h2", branch: "watch-pr-tool", title: "Poll pull request checks without rate limits", minutes: 60 * 20),
          saved("h3", branch: "main", title: "Why is notarization slow on CI", minutes: 60 * 50),
        ]
      ])
      return fixtures
    }

    private static var terminals: [TerminalsStore.Tab] {
      [
        .init(id: "t1", sessionId: "s-long", title: "Web dev server", runTitle: "Web dev server"),
        .init(id: "t2", sessionId: "s-long", title: "zsh"),
        .init(id: "t3", sessionId: "s-pr", title: "Host tests", runTitle: "Host tests", exitCode: 1),
        .init(id: "t4", sessionId: "rn-1", title: "Metro (Native)", runTitle: "Metro (Native)"),
      ]
    }
  }
#endif
