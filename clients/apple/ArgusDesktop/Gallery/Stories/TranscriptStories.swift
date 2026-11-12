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
        }
      ]
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
      ("question-expired", .expiredQuestion), ("plan", .plan), ("subagents", .subagents), ("stopped", .stopped), ("limit", .limit), ("empty", .empty),
      ("handoff", .handoff), ("command", .command),
    ]
  }
#endif
