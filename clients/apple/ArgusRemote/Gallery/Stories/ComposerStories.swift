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
        // Following the default, on it; then still on Work after the default moved to Personal.
        GalleryStory(
          "composer/account-menu/on-default", fixtures: GalleryFixtures.transcript(.idle),
          setup: { await loadAccountMenu($0.host) }
        ) { AccountMenuStory() },
        GalleryStory(
          "composer/account-menu/default-changed", fixtures: GalleryFixtures.transcript(.idle, runningOn: "work"),
          setup: { await loadAccountMenu($0.host) }
        ) { AccountMenuStory() },
      ]
    }

    private static func loadAccountMenu(_ host: HostStore) async {
      let agent = GalleryFixtures.transcriptAgent
      await host.loadAgentStatus(agentId: agent)
      await host.refreshClaudeAccounts()
    }
  }

  /// The composer's account picker, as the phone's sheet shows it.
  private struct AccountMenuStory: View {
    @Environment(HostStore.self) private var host

    var body: some View {
      PhoneComposerPickerSheet(
        composer: ComposerModel(
          agentId: GalleryFixtures.transcriptAgent, sessionId: GalleryFixtures.transcriptSession, host: host,
          style: .phone),
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
