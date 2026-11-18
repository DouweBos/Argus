#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// The agent pane, its transcript over the composer, in every state it waits in.
  enum TranscriptStories {
    static var all: [GalleryStory] {
      states.map { name, state in
        GalleryStory(
          "transcript/\(name)", size: CGSize(width: 960, height: 820), fixtures: GalleryFixtures.transcript(state),
          setup: { _ in }
        ) {
          AgentPane(agentId: GalleryFixtures.transcriptAgent, sessionId: GalleryFixtures.transcriptSession)
        }
      } + [
        GalleryStory(
          "transcript/question-expired-card", size: CGSize(width: 640, height: 80),
          fixtures: GalleryFixtures.transcript(.expiredQuestion)
        ) {
          ToolCallCard(agentKey: GalleryFixtures.transcriptAgent, call: GalleryFixtures.expiredQuestionCall, depth: 0)
            .padding(16)
            .frame(maxHeight: .infinity, alignment: .top)
        },
        GalleryStory(
          "agent/mcp-servers", size: CGSize(width: 320, height: 420), fixtures: GalleryFixtures.transcript(.idle)
        ) {
          AgentMcpServersView(agentId: GalleryFixtures.transcriptAgent)
            .frame(maxHeight: .infinity, alignment: .top)
        },
        GalleryStory(
          "agent/side-question", size: CGSize(width: 420, height: 420),
          fixtures: GalleryFixtures.transcript(.idle), setup: askSide
        ) {
          // As the composer's popover sizes it.
          SideQuestionPanel(agentId: GalleryFixtures.transcriptAgent)
            .padding(14)
            .frame(width: 420)
            .frame(maxHeight: 520)
            .frame(maxHeight: .infinity, alignment: .top)
        },
        GalleryStory(
          "agent/mcp-servers-signing-in", size: CGSize(width: 320, height: 480),
          fixtures: GalleryFixtures.transcript(.idle), setup: signInToLinear
        ) {
          AgentMcpServersView(agentId: GalleryFixtures.transcriptAgent)
            .frame(maxHeight: .infinity, alignment: .top)
        },
      ]
    }

    static func signInToLinear(_ stage: GalleryStage) async {
      await stage.host.actOnMcpServer(
        agentId: GalleryFixtures.transcriptAgent, server: "plugin:team-tools:linear", action: .signIn)
    }

    private static func askSide(_ stage: GalleryStage) async {
      await stage.host.askSide(agentId: GalleryFixtures.transcriptAgent, question: "Is Aubrey a male or female name?")
    }

    /// Loaded before the pane appears, so the table lays out the whole chat at once.
    static func load(_ host: HostStore) async {
      let agent = GalleryFixtures.transcriptAgent
      await host.loadAgentStatus(agentId: agent)
      await host.loadTranscript(agentId: agent)
      await host.loadQueue(agentId: agent)
    }

    static let states: [(String, GalleryFixtures.TranscriptState)] = [
      ("idle", .idle), ("working", .working), ("permission", .permission), ("question", .question),
      ("secret", .secret), ("question-expired", .expiredQuestion), ("plan", .plan), ("subagents", .subagents), ("stopped", .stopped), ("limit", .limit), ("empty", .empty),
      ("handoff", .handoff), ("command", .command), ("artifact", .artifact),
    ]
  }
#endif
