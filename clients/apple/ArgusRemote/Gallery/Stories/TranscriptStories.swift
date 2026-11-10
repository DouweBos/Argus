#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// The agent screen, its transcript over the composer, in every state it waits in.
  enum TranscriptStories {
    static var all: [GalleryStory] {
      states.map { name, state in
        GalleryStory("transcript/\(name)", fixtures: GalleryFixtures.transcript(state)) {
          AgentView(agentId: GalleryFixtures.transcriptAgent, label: "Cap the iPad transcript")
            .navigationTitle("Cap the iPad transcript")
            .inlineNavigationTitle()
        }
      } + [
        GalleryStory("agent/mcp-servers", fixtures: GalleryFixtures.transcript(.idle)) {
          AgentMcpServersView(agentId: GalleryFixtures.transcriptAgent)
            .frame(maxHeight: .infinity, alignment: .top)
            .navigationTitle("MCP Servers")
            .inlineNavigationTitle()
        }
      ]
    }

    static let states: [(String, GalleryFixtures.TranscriptState)] = [
      ("idle", .idle), ("working", .working), ("permission", .permission), ("question", .question),
      ("plan", .plan), ("subagents", .subagents), ("stopped", .stopped), ("limit", .limit), ("empty", .empty),
    ]
  }
#endif
