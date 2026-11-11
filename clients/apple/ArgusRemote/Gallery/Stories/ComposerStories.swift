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
        GalleryStory("composer/dictation") { DictationStory(size: 34) },
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
        GalleryStory(
          "composer/usage-limits", fixtures: GalleryFixtures.composer.merging(GalleryFixtures.usage) { $1 },
          setup: { await $0.host.loadUsageLimits() }
        ) { UsageLimitsComposerStory() },
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

  /// `/usage-limits`' panel over the chat composer, as it opens for a Claude Code agent.
  private struct UsageLimitsComposerStory: View {
    @Environment(HostStore.self) private var host

    var body: some View {
      VStack(spacing: 0) {
        Spacer()
        ComposerUsageLimitsPanel(groups: UsageLimitFormat.groups(host.usageLimits, runner: "claude-code")) {}
          .padding(.horizontal, 10)
        ChatInputView(agentId: "a1")
      }
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

  /// The mic in each phase, and the banner a refused microphone leaves above the composer.
  private struct DictationStory: View {
    @Environment(\.theme) private var theme
    let size: CGFloat
    private let phases: [(String, DictationPhase)] = [
      ("Idle", .idle), ("Getting ready", .starting), ("Listening", .listening), ("Finishing", .finishing),
    ]

    var body: some View {
      VStack(alignment: .leading, spacing: 12) {
        Banner(text: DictationError.microphoneDenied.errorDescription ?? "", actionLabel: "Dismiss") {}
        ForEach(phases, id: \.0) { name, phase in
          HStack(spacing: 10) {
            DictationButton(phase: phase, size: size) {}
            Text(name).font(.scaled(size: 13)).foregroundStyle(theme.textSecondary)
          }
        }
        HStack(spacing: 10) {
          DictationButton(phase: .idle, size: size) {}.disabled(true)
          Text("Agent not running").font(.scaled(size: 13)).foregroundStyle(theme.textSecondary)
        }
      }
      .padding(16)
    }
  }
#endif
