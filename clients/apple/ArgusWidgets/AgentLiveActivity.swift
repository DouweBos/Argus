import ActivityKit
import ArgusKit
import SwiftUI
import WidgetKit

/// The agents' Live Activity: the Lock Screen card and the Dynamic Island.
struct AgentLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: AgentActivityAttributes.self) { context in
      AgentActivityCard(
        hostId: context.attributes.hostId, hostName: context.attributes.hostName,
        canRespond: context.attributes.canRespond, state: context.state, isStale: context.isStale
      ) { agent, prompt in
        AnswerButtons(hostId: context.attributes.hostId, agentId: agent.id, prompt: prompt)
      }
      .activityBackgroundTint(nil)
    } dynamicIsland: { context in
      let state = context.state
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Label(state.phase.label, systemImage: state.phase.symbol)
            .font(.caption.weight(.semibold)).foregroundStyle(state.phase.tint).padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          if let lead = state.lead {
            AgentElapsed(agent: lead).font(.caption).frame(maxWidth: 60, alignment: .trailing)
              .padding(.trailing, 4)
          }
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 6) {
            if let lead = state.lead {
              AgentActivityRow(agent: lead, hostId: context.attributes.hostId)
            } else {
              Text("Open Argus to see your agents.").font(.caption).foregroundStyle(.secondary)
            }
            if context.attributes.canRespond, let agent = state.promptAgent, let prompt = agent.prompt {
              AgentPromptStrip(prompt: prompt) {
                AnswerButtons(hostId: context.attributes.hostId, agentId: agent.id, prompt: prompt)
              }
            }
          }
        }
      } compactLeading: {
        AgentIslandLeading(state: state)
      } compactTrailing: {
        AgentIslandTrailing(state: state)
      } minimal: {
        AgentIslandLeading(state: state)
      }
      .keylineTint(state.phase.tint)
    }
  }
}

private struct AnswerButtons: View {
  let hostId: String
  let agentId: String
  let prompt: AgentActivityAgent.Prompt

  var body: some View {
    Button(intent: AnswerPromptIntent(hostId: hostId, agentId: agentId, toolUseId: prompt.toolUseId, allow: false)) {
      Text("Deny").frame(maxWidth: .infinity)
    }
    .tint(.red)
    .buttonStyle(.borderedProminent)
    Button(intent: AnswerPromptIntent(hostId: hostId, agentId: agentId, toolUseId: prompt.toolUseId, allow: true)) {
      Text("Approve").frame(maxWidth: .infinity)
    }
    .tint(.green)
    .buttonStyle(.borderedProminent)
  }
}
