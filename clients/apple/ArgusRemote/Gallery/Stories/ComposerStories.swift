#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  enum ComposerStories {
    static var all: [GalleryStory] {
      [
        GalleryStory("composer/start", fixtures: GalleryFixtures.composer) {
          AgentStartPane(
            repoRoot: "/Users/dev/Projects/Argus", sessionId: nil, workspace: .worktree, picksProject: true
          ) { _, _ in }
          .navigationTitle("New Session")
          .inlineNavigationTitle()
        },
        GalleryStory(
          "sessions/start-from-issue",
          fixtures: GalleryFixtures.composer.merging(GalleryFixtures.homeWithLinear) { old, _ in old }
        ) {
          AgentStartPane(
            repoRoot: "/Users/dev/Projects/Argus", sessionId: nil, workspace: .worktree,
            issues: [GalleryFixtures.linearIssue], picksProject: true
          ) { _, _ in }
          .navigationTitle("New Session")
          .inlineNavigationTitle()
        },
        GalleryStory("composer/chat", fixtures: GalleryFixtures.composer) { ChatComposerStory() },
        // An agent running on Work while the computer's default is Personal; then a start composer.
        GalleryStory(
          "composer/account-menu/running", fixtures: GalleryFixtures.transcript(.idle, runningOn: "work"),
          setup: { await loadAccountMenu($0.host) }
        ) { AccountMenuStory(starts: false) },
        GalleryStory(
          "composer/account-menu/start", fixtures: GalleryFixtures.transcript(.idle),
          setup: { await loadAccountMenu($0.host) }
        ) { AccountMenuStory(starts: true) },
      ]
    }

    private static func loadAccountMenu(_ host: HostStore) async {
      let agent = GalleryFixtures.transcriptAgent
      await host.loadAgentStatus(agentId: agent)
      await host.loadTranscript(agentId: agent)
      await host.refreshClaudeAccounts()
    }
  }

  /// The composer's account picker, as the phone's sheet shows it.
  private struct AccountMenuStory: View {
    let starts: Bool
    @Environment(HostStore.self) private var host

    var body: some View {
      PhoneComposerPickerSheet(
        composer: ComposerModel(
          agentId: GalleryFixtures.transcriptAgent, sessionId: GalleryFixtures.transcriptSession, host: host,
          starter: starts ? ComposerStarter(defaultMode: "auto") { _ in true } : nil, style: .phone),
        which: .account)
    }
  }

  /// The chat composer at the foot of an empty screen, as under a transcript.
  private struct ChatComposerStory: View {
    var body: some View {
      VStack(spacing: 0) {
        Spacer()
        ChatInputView(agentId: "a1")
      }
    }
  }
#endif
