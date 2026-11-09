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
        GalleryStory("composer/chat", fixtures: GalleryFixtures.composer) { ChatComposerStory() },
      ]
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
