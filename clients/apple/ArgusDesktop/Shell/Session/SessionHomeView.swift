import ArgusCore
import ArgusUI
import SwiftUI

/// `/sessions/:id/home`: what the session is, how its setup went, the agents
/// working in it, and landing the work — the desktop app's session home.
struct SessionHomeView: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(\.theme) private var theme
  let session: RemoteSession
  /// The session's agents, as its agent tabs show them.
  let sessionAgents: [RemoteAgentStatus]
  let startAgent: (RemotePermissionMode?) -> Void

  /// Active agents, newest first, as the desktop app lists them.
  private var agents: [RemoteAgentStatus] {
    sessionAgents
      .filter { $0.status != .stopped }
      .sorted { ($0.createdAt ?? 0) > ($1.createdAt ?? 0) }
  }

  private var projectName: String {
    store.projects.first { $0.repoRoot == session.repoRoot }?.name
      ?? URL(fileURLWithPath: session.repoRoot).lastPathComponent
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        SessionHomeHero(
          session: session, projectName: projectName,
          canStart: session.status == .ready, startAgent: startAgent)
        SessionPathRow(sessionId: session.id, status: session.status)
        switch session.status {
        case .initializing:
          SetupProgressCard(session: session)
        case .error:
          Card { SetupFailedRow(session: session) }
        default:
          EmptyView()
        }
        if !agents.isEmpty {
          activeAgents
        }
        if session.kind == .worktree, session.status == .ready {
          LandWorkCard(sessionId: session.id) { await store.loadGitStatus(sessionId: session.id) }
        }
      }
      .padding(24)
      .frame(maxWidth: 760, alignment: .leading)
      .frame(maxWidth: .infinity)
    }
    // The card's commit and merge state follow the worktree as agents edit it.
    .liveRefresh(enabled: session.status == .ready && session.kind == .worktree, every: .seconds(5)) {
      await store.loadGitStatus(sessionId: session.id)
    }
  }

  private var activeAgents: some View {
    Card {
      SectionHeader(title: "Active agents", count: agents.count)
      ForEach(agents) { agent in
        Button {
          model.navigate(.session(id: session.id, agentId: agent.agentId))
        } label: {
          AgentRow(
            name: Labels.agentName(agent), status: agent.status,
            attention: Labels.awaitingLabel(agent), model: agent.model,
            meta: Labels.metaLabel(agent.status))
          .contentShape(.rect)
        }
        .buttonStyle(.plain)
      }
    }
  }
}

/// Name, branch, base and project, with the ways to start working.
private struct SessionHomeHero: View {
  @Environment(\.theme) private var theme
  let session: RemoteSession
  let projectName: String
  let canStart: Bool
  let startAgent: (RemotePermissionMode?) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .top, spacing: 12) {
        Image(systemName: session.kind == .scratchPad ? "note.text" : Icon.branch)
          .font(.system(size: 16, weight: .semibold))
          .frame(width: 36, height: 36)
          .background(theme.accentSoft, in: .rect(cornerRadius: theme.radiusSmall))
          .foregroundStyle(theme.accent)
        VStack(alignment: .leading, spacing: 4) {
          Text(session.displayName ?? session.branch)
            .font(.title2.weight(.semibold))
            .lineLimit(2)
          Text(subtitle)
            .font(.callout)
            .foregroundStyle(.secondary)
            .lineLimit(2)
        }
      }
      // Their own row, so a narrow column never squeezes them.
      HStack(spacing: 8) {
        Button("Start Agent") { startAgent(nil) }
          .buttonStyle(.borderedProminent)
        Button("Plan Mode") { startAgent(.plan) }
          .help("Start in plan mode — the agent presents a plan for approval before any writes")
      }
      .disabled(!canStart)
    }
  }

  private var subtitle: String {
    if session.kind == .scratchPad { return "Scratch pad — not tied to any project" }
    var parts = [session.branch].filter { !$0.isEmpty }
    if let base = session.baseBranch { parts.append("from \(base)") }
    parts.append("in \(projectName)")
    return parts.joined(separator: " · ")
  }
}

/// The worktree on disk: reveal it, open it in an editor, or copy the path.
private struct SessionPathRow: View {
  @Environment(HostStore.self) private var store
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  let sessionId: String
  /// The worktree only exists once setup has created it.
  let status: RemoteSessionStatus
  @State private var path: String?
  @State private var editors: [ArgusProtocol.EditorDescriptor] = []

  var body: some View {
    HStack(spacing: 8) {
      Text(path.map(Self.tilde) ?? " ")
        .font(.system(size: 12, design: .monospaced))
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .truncationMode(.middle)
        .textSelection(.enabled)
      Spacer(minLength: 8)
      // Editors and Finder would open this Mac's disk, not the host's.
      if let path, model.host(ofSession: sessionId) != Hosts.local {
        Text("on \(model.hosts.label(model.host(ofSession: sessionId)))")
          .font(.caption).foregroundStyle(.secondary)
        copyButton(path)
      } else if let path {
        let custom = AppPreferences.shared.customEditors
        if !editors.isEmpty || !custom.isEmpty {
          Menu("Open In") {
            ForEach(editors, id: \.id) { editor in
              Button(editor.name) {
                send(ArgusProtocol.Commands.OpenInEditor.self, .init(editorId: editor.id, path: path))
              }
            }
            if !editors.isEmpty, !custom.isEmpty { Divider() }
            ForEach(custom) { editor in
              Button(editor.name) {
                send(ArgusProtocol.Commands.OpenInCustomEditor.self, .init(command: editor.command, path: path))
              }
            }
          }
          .fixedSize()
        }
        Button {
          send(ArgusProtocol.Commands.RevealInFinder.self, .init(path: path))
        } label: {
          Image(systemName: "folder")
        }
        .help("Reveal in Finder")
        copyButton(path)
      }
    }
    .controlSize(.small)
    .task(id: "\(sessionId):\(status.rawValue)") {
      guard let backend = store.backend else { return }
      path = (try? await backend.request(ArgusProtocol.Commands.GetSession.self, .init(id: sessionId)))??.path
      editors = (try? await backend.request(ArgusProtocol.Commands.ListEditors.self, EmptyParams()))?
        .filter { $0.available && !["iterm", "terminal"].contains($0.id) } ?? []
    }
  }

  private func copyButton(_ path: String) -> some View {
    Button {
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(path, forType: .string)
    } label: {
      Image(systemName: "doc.on.doc")
    }
    .help("Copy path")
  }

  private func send<C: RemoteCommand>(_ command: C.Type, _ params: C.Params) {
    guard let backend = store.backend else { return }
    Task { _ = try? await backend.request(command, params) }
  }

  private static func tilde(_ path: String) -> String {
    let home = NSHomeDirectory()
    return path.hasPrefix(home) ? "~" + path.dropFirst(home.count) : path
  }
}

/// Which setup step is running and on what, from the host's
/// `session:setup_progress` broadcasts, which carry more than the listed count.
private struct SetupProgressCard: View {
  @Environment(HostStore.self) private var store
  @Environment(\.theme) private var theme
  let session: RemoteSession
  @State private var step: Step?

  struct Step: Decodable {
    let current: Double
    let total: Double
    let item: String
    let phase: String?
    let detail: String?
  }

  private static let phaseLabels = [
    "matching": "Matching files", "copy": "Copying", "symlink": "Linking",
    "command": "Running setup commands",
  ]

  var body: some View {
    Card {
      HStack(spacing: 8) {
        ProgressView().controlSize(.small)
        Text(step.flatMap { $0.phase.flatMap { Self.phaseLabels[$0] } } ?? "Initializing session")
          .font(.headline)
        Spacer()
        Text(stepLine).font(.caption).foregroundStyle(.secondary)
      }
      if let fraction = fraction {
        ProgressView(value: fraction)
      } else {
        ProgressView().progressViewStyle(.linear)
      }
      if let step {
        Text(step.item).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(1)
          .truncationMode(.middle)
        if let detail = step.detail {
          Text(detail).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(1)
            .truncationMode(.middle)
        }
      }
    }
    .task(id: session.id) {
      let channel = "session:setup_progress:\(session.id)"
      let stop = store.observeIpc { name, args, _ in
        guard name == channel, let arg = args.first,
          let next = try? ProtocolCodec.convert(arg, to: Step.self)
        else { return }
        step = next
      }
      // Hold the observer for as long as the card is up.
      while !Task.isCancelled { try? await Task.sleep(for: .seconds(3600)) }
      stop()
    }
  }

  private var fraction: Double? {
    if let step, step.total > 0 { return min(max(step.current / step.total, 0), 1) }
    return session.progress?.fraction
  }

  private var stepLine: String {
    guard let step, step.total > 0 else { return "Preparing the worktree…" }
    return "Step \(Int(step.current)) of \(Int(step.total)) · \(max(Int(step.total - step.current), 0)) remaining"
  }
}
