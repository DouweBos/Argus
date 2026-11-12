import ArgusKit
import SwiftUI
import WidgetKit

// Shared with the app target so the gallery renders the same card.

extension AgentActivityAgent.State {
  var tint: Color {
    switch self {
    case .working: .blue
    case .needsYou: .orange
    case .done: .green
    case .failed: .red
    }
  }

  var symbol: String {
    switch self {
    case .working: "sparkles"
    case .needsYou: "hand.raised.fill"
    case .done: "checkmark.circle.fill"
    case .failed: "xmark.octagon.fill"
    }
  }

  var label: String {
    switch self {
    case .working: "Working"
    case .needsYou: "Needs you"
    case .done: "Done"
    case .failed: "Failed"
    }
  }
}

extension AgentActivityState {
  var agents: [AgentActivityAgent] { snapshot?.agents ?? [] }
  /// The agent whose prompt the card offers to answer.
  var promptAgent: AgentActivityAgent? { agents.first { $0.state == .needsYou && $0.prompt != nil } }
  var lead: AgentActivityAgent? { agents.first }
}

/// Elapsed time: ticking while it works, frozen once it ended.
struct AgentElapsed: View {
  let agent: AgentActivityAgent

  var body: some View {
    Group {
      if let ended = agent.ended {
        Text(Duration.seconds(max(0, ended.timeIntervalSince(agent.started))).formatted(.time(pattern: .minuteSecond)))
      } else {
        Text(timerInterval: agent.started...Date.distantFuture, countsDown: false)
      }
    }
    .monospacedDigit()
  }
}

/// One agent: its state, title, and the step it is on or how it ended.
struct AgentActivityRow: View {
  let agent: AgentActivityAgent
  let hostId: String

  var body: some View {
    Link(destination: WidgetLink.agentURL(sessionId: agent.sessionId, agentId: agent.id, hostId: hostId)) {
      HStack(spacing: 8) {
        Image(systemName: agent.state.symbol).font(.subheadline).foregroundStyle(agent.state.tint)
          .frame(width: 18)
        VStack(alignment: .leading, spacing: 1) {
          Text(agent.title).font(.subheadline.weight(.semibold)).lineLimit(1)
          Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        Spacer(minLength: 4)
        AgentElapsed(agent: agent).font(.caption).foregroundStyle(.secondary)
          .multilineTextAlignment(.trailing).frame(maxWidth: 56, alignment: .trailing)
      }
    }
  }

  private var detail: String {
    let what = agent.state == .working ? (agent.step ?? agent.state.label) : agent.state.label
    return [what, agent.project].compactMap { $0 }.joined(separator: " · ")
  }
}

/// The prompt waiting on you, with whatever answers it.
struct AgentPromptStrip<Buttons: View>: View {
  let prompt: AgentActivityAgent.Prompt
  @ViewBuilder let buttons: () -> Buttons

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(prompt.summary).font(.caption.monospaced()).lineLimit(2)
        .frame(maxWidth: .infinity, alignment: .leading)
      HStack(spacing: 8) { buttons() }
    }
    .padding(8)
    .background(.orange.opacity(0.15), in: RoundedRectangle(cornerRadius: 10))
  }
}

/// The Lock Screen card: this computer's agents, waiting ones first, and
/// Approve/Deny for the first prompt when this phone may answer it.
struct AgentActivityCard<Buttons: View>: View {
  let hostId: String
  let hostName: String
  let canRespond: Bool
  let state: AgentActivityState
  let isStale: Bool
  @ViewBuilder let buttons: (AgentActivityAgent, AgentActivityAgent.Prompt) -> Buttons

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 6) {
        Image(systemName: "eye.circle.fill").foregroundStyle(.tint)
        Text(hostName).font(.caption.weight(.semibold)).lineLimit(1)
        Spacer(minLength: 4)
        Text(headline).font(.caption).foregroundStyle(isStale ? .tertiary : .secondary).lineLimit(1)
      }
      if state.snapshot == nil {
        Label(state.phase.label, systemImage: state.phase.symbol).font(.subheadline.weight(.semibold))
          .foregroundStyle(state.phase.tint)
        Text("Open Argus to see your agents.").font(.caption).foregroundStyle(.secondary)
      } else {
        ForEach(state.agents) { agent in
          AgentActivityRow(agent: agent, hostId: hostId)
          if canRespond, agent.id == state.promptAgent?.id, let prompt = agent.prompt {
            AgentPromptStrip(prompt: prompt) { buttons(agent, prompt) }
          }
        }
        if let more = state.snapshot?.more, more > 0 {
          Text("+\(more) more").font(.caption2).foregroundStyle(.tertiary)
        }
      }
    }
    .padding(14)
  }

  private var headline: String {
    if isStale { return "Not updating" }
    let agents = state.agents
    let waiting = agents.count { $0.state == .needsYou }
    let working = agents.count { $0.state == .working }
    if waiting > 0 { return "\(waiting) need\(waiting == 1 ? "s" : "") you" }
    if working > 0 { return "\(working) working" }
    return state.phase == .failed ? "Failed" : "All done"
  }
}

/// The compact island: the most urgent agent's state, and its clock.
struct AgentIslandLeading: View {
  let state: AgentActivityState

  var body: some View {
    Image(systemName: state.phase.symbol).foregroundStyle(state.phase.tint)
  }
}

struct AgentIslandTrailing: View {
  let state: AgentActivityState

  var body: some View {
    if state.phase == .needsYou {
      Text("Approve?").font(.caption2.weight(.semibold)).foregroundStyle(.orange)
    } else if let lead = state.lead {
      AgentElapsed(agent: lead).font(.caption2).frame(maxWidth: 44)
    } else {
      Text(state.phase.label).font(.caption2)
    }
  }
}
