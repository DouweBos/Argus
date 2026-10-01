import ArgusUI
import SwiftUI

/// One session: its agents as tabs, the focused agent's transcript and input.
struct SessionView: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  let sessionId: String

  private var session: RemoteSession? {
    store.sessionsByRepo.values.joined().first { $0.id == sessionId }
      ?? store.scratchPads.first { $0.id == sessionId }
  }

  /// Live agents first — they appear the moment the host starts them — with
  /// the host's last status laid over for title and attention.
  private var agents: [RemoteAgentStatus] {
    guard let session else { return [] }
    let listed = (store.agentsByRepo[session.repoRoot] ?? []).filter { $0.sessionId == sessionId }
    guard let live = store.live else {
      return listed.sorted { ($0.createdAt ?? 0) < ($1.createdAt ?? 0) }
    }
    return live.agents(inSession: sessionId).compactMap { agent in
      guard
        var status = store.statusByAgent[agent.id] ?? listed.first(where: { $0.agentId == agent.id })
          ?? Self.placeholder(agentId: agent.id, sessionId: sessionId)
      else { return nil }
      status.status = agent.status
      status.title = live.conversation(for: agent.id)?.title ?? status.title
      return status
    }
  }

  /// An agent the host hasn't described yet; the wire type has no public init.
  private static func placeholder(agentId: String, sessionId: String) -> RemoteAgentStatus? {
    try? ProtocolCodec.convert(
      .object([
        "agent_id": .string(agentId), "session_id": .string(sessionId),
        "status": .string("running"),
      ]), to: RemoteAgentStatus.self)
  }

  /// The routed agent, else the first — a session always shows something.
  private var focusedAgentId: String? {
    model.route.agentId.flatMap { id in agents.contains { $0.agentId == id } ? id : nil }
      ?? agents.first?.agentId
  }

  var body: some View {
    VStack(spacing: 0) {
      AgentTabBar(
        agents: agents, focused: focusedAgentId,
        select: { model.navigate(.session(id: sessionId, agentId: $0)) })
      Divider()
      if let session, session.status != .ready {
        SessionSetupView(session: session)
      } else if let agentId = focusedAgentId {
        AgentPane(agentId: agentId, sessionId: sessionId)
          .id(agentId)
      } else {
        ContentUnavailableView(
          "No agents", systemImage: "sparkles",
          description: Text("Agents running in this session show here."))
      }
    }
    .navigationTitle(session?.displayName ?? session?.branch ?? "Session")
    .navigationSubtitle(session?.branch ?? "")
    .task(id: session?.repoRoot) {
      if let repoRoot = session?.repoRoot { await store.loadAgents(repoRoot: repoRoot) }
    }
  }
}

struct AgentTabBar: View {
  let agents: [RemoteAgentStatus]
  let focused: String?
  let select: (String) -> Void

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 4) {
        ForEach(agents) { agent in
          Button {
            select(agent.agentId)
          } label: {
            HStack(spacing: 6) {
              StatusDot(
                tone: agent.awaiting != nil ? .warning : agent.status.tone,
                pulse: agent.status == .running)
              Text(agent.title ?? "Agent").lineLimit(1)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(
              agent.agentId == focused ? AnyShapeStyle(.selection) : AnyShapeStyle(.clear),
              in: .rect(cornerRadius: 6))
          }
          .buttonStyle(.plain)
        }
      }
      .padding(.horizontal, 8)
      .padding(.vertical, 6)
    }
  }
}

/// The focused agent: its transcript, kept live, and the input that drives it.
struct AgentPane: View {
  @Environment(HostStore.self) private var store
  let agentId: String
  let sessionId: String

  var body: some View {
    VStack(spacing: 0) {
      TranscriptView(agentKey: agentId, sessionId: sessionId, fixture: TranscriptStress.fixture)
      ChatInputView(agentId: agentId, sessionId: sessionId) { affordance in
        MacTelemetry.capture(.inputUsed(affordance: affordance.rawValue))
      }
    }
    .task {
      await store.watchAgent(agentId, on: true)
      await store.loadTranscript(agentId: agentId)
      await store.loadCapabilities(agentId: agentId)
    }
    .onDisappear {
      Task { await store.watchAgent(agentId, on: false) }
    }
  }
}

/// A session still being set up (or torn down), or one whose setup failed.
struct SessionSetupView: View {
  let session: RemoteSession

  var body: some View {
    VStack(spacing: 16) {
      switch session.status {
      case .error:
        SetupFailedRow(session: session).frame(maxWidth: 520)
      case .deleting:
        progress("Deleting the worktree…")
      default:
        progress("Setting up the worktree…")
      }
    }
    .padding(24)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  @ViewBuilder
  private func progress(_ title: String) -> some View {
    Text(title).foregroundStyle(.secondary)
    if let fraction = session.progress?.fraction {
      ProgressView(value: fraction).frame(maxWidth: 320)
    } else {
      ProgressView()
    }
  }
}
