#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// The agent screen, its transcript over the composer, in every state it waits in, and replies
  /// that haven't reached the computer: held while offline, and refused.
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
        },
        GalleryStory("transcript/unsent-replies", screen: false, chrome: false) {
          VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Waiting for connection", count: waiting.count)
            ForEach(waiting) { FailedSendCard(agentKey: "a1", item: $0, waiting: true) }
            SectionHeader(title: "Not sent", count: 1)
            FailedSendCard(agentKey: "a1", item: refused)
          }
          .padding(16)
        },
      ]
    }

    static let states: [(String, GalleryFixtures.TranscriptState)] = [
      ("idle", .idle), ("working", .working), ("permission", .permission), ("question", .question),
      ("plan", .plan), ("subagents", .subagents), ("stopped", .stopped), ("limit", .limit), ("empty", .empty),
      ("handoff", .handoff), ("command", .command),
    ]

    private static let waiting = [
      FailedSend(
        id: "w1", body: "Looks good, also run the iOS gallery before you commit",
        displayText: nil, images: []),
      FailedSend(
        id: "w2", body: "And keep the pill under the title on iPad", displayText: nil, images: []),
    ]

    private static let refused = FailedSend(
      id: "f1", body: "Can you split the cache into its own commit?", displayText: nil, images: [])
  }
#endif
