#if DEBUG
  import ArgusCore
  import ArgusKit
  import ArgusUI
  import SwiftUI

  /// Home, the agents overview and the sidebar's projects, over a dozen projects.
  enum HomeStories {
    static var all: [GalleryStory] {
      [
        GalleryStory(
          "home/loaded", size: CGSize(width: 1100, height: 1100), chrome: true, fixtures: GalleryFixtures.home,
          setup: load
        ) { HomeScreen() },
        GalleryStory(
          "home/empty", size: CGSize(width: 1100, height: 700), chrome: true, fixtures: GalleryFixtures.homeEmpty,
          setup: load
        ) { HomeScreen() },
        accountRemoved,
        GalleryStory(
          "agents/overview", size: CGSize(width: 1100, height: 480), chrome: true, fixtures: GalleryFixtures.home,
          setup: load
        ) { AgentsOverview() },
        GalleryStory(
          "sessions/sidebar", size: CGSize(width: 280, height: 1000), fixtures: GalleryFixtures.home, setup: load
        ) { SidebarView() },
        setup("sessions/setup/progress", "s-setup"),
        setup("sessions/setup/failed", "s-failed"),
        GalleryStory(
          "sessions/context-card", size: CGSize(width: 900, height: 700), fixtures: GalleryFixtures.home,
          setup: load
        ) {
          Color.clear.sessionContextCard(GalleryFixtures.argusSession("s-long"), panel: .agents)
        },
        GalleryStory(
          "sessions/context-card-setup-pending", size: CGSize(width: 900, height: 700),
          fixtures: GalleryFixtures.home, setup: load
        ) {
          Color.clear.sessionContextCard(
            GalleryFixtures.argusSession("s-long", overrides: ["setup_pending": true]), panel: .agents)
        },
        // Mac only: the phone starts a session from its composer, and deletes through a confirmation dialog.
        GalleryStory(
          "sessions/new-sheet", size: CGSize(width: 480, height: 560), fixtures: GalleryFixtures.home, setup: load
        ) {
          NewSessionSheet(project: GalleryFixtures.argusProject) { _ in }
        },
        GalleryStory(
          "sessions/start-from-issue", size: CGSize(width: 480, height: 640),
          fixtures: GalleryFixtures.homeWithLinear, setup: load
        ) {
          NewSessionSheet(project: GalleryFixtures.argusProject, issues: [GalleryFixtures.linearIssue]) { _ in }
        },
        GalleryStory(
          "sessions/delete-sheet", size: CGSize(width: 420, height: 0), fixtures: GalleryFixtures.home, setup: load
        ) {
          DeleteSessionSheet(session: GalleryFixtures.argusSession("s-long")) {}
        },
        // Mac only: installers and sign-in run in a terminal on this Mac, which the phone can't drive.
        runnerSetup("runners/setup-installing", installed: false, phase: .running(terminalId: "gallery-setup")),
        runnerSetup("runners/setup-sign-in", installed: true, phase: .finished(terminalId: "gallery-setup", exitCode: 0)),
        runnerSetup("runners/setup-failed", installed: false, phase: .finished(terminalId: "gallery-setup", exitCode: 1)),
        runnerSetup(
          "runners/setup-page", runner: "Antigravity", setup: .init(installUrl: "https://antigravity.google", loginCommand: "agy acp --login"),
          installed: false, phase: .openedPage(url: "https://antigravity.google")),
      ]
    }

    /// The runner setup sheet at one point of Install → Sign in.
    private static func runnerSetup(
      _ id: String, runner: String = "Gemini CLI",
      setup: RemoteRunner.Setup = .init(installCommand: "npm install -g @google/gemini-cli", loginCommand: "gemini"),
      installed: Bool, phase: RunnerSetupFlow.Phase
    ) -> GalleryStory {
      GalleryStory(id, size: CGSize(width: 640, height: 480), fixtures: GalleryFixtures.home) {
        let model = RunnerSetupModel()
        var flow = RunnerSetupFlow(runnerId: "gemini", displayName: runner, setup: setup, installed: installed)
        flow.step = .install
        flow.phase = phase
        model.flow = flow
        return RunnerSetupSheet(setup: model)
      }
    }

    /// A session's pane while its worktree is set up, or after that failed.
    private static func setup(_ id: String, _ session: String) -> GalleryStory {
      GalleryStory(id, size: CGSize(width: 900, height: 480), fixtures: GalleryFixtures.home, setup: load) {
        let session = GalleryFixtures.argusSession(session)
        SessionSetupView(session: session, progress: session.progress)
      }
    }

    /// Home under the main window's notice that another device removed this Mac from the account.
    private static var accountRemoved: GalleryStory {
      GalleryStory(
        "home/account-removed", size: CGSize(width: 1100, height: 700), chrome: true, fixtures: GalleryFixtures.home,
        setup: { stage in
          await load(stage)
          stage.model.account.galleryFill(GalleryAccount(phase: .signedOut, selfKind: "mac", removed: true))
        }
      ) {
        VStack(spacing: 0) {
          AccountRemovedNotice()
          HomeScreen()
        }
      }
    }

    @MainActor static func load(_ stage: GalleryStage) async {
      await GalleryFixtures.loadHome(stage.host)
      await stage.model.automations.refresh()
      await stage.model.inbox.refresh()
    }
  }
#endif
