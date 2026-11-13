import ArgusCore
import ArgusUI
import SwiftUI

/// The context card's stack rows: where the session sits in its stack,
/// Restack and Land Stack, and starting a new session on top of it.
struct StackContextRows: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(\.theme) private var theme
  let session: RemoteSession
  @State private var busy = false

  private var actions: StackActions { StackActions(model: model, store: store) }
  private var members: [RemoteSession] { actions.members(of: session) }
  private var note: String? { members.first.flatMap { model.stackNotes[$0.id] } ?? model.stackNotes[session.id] }

  var body: some View {
    if !members.isEmpty, let position = members.firstIndex(where: { $0.id == session.id }) {
      ContextCardRow(icon: Icon.stacked, title: "Stack") {
        Text("\(position + 1) of \(members.count)")
          .font(.scaled(size: 11)).foregroundStyle(theme.textSecondary)
      }
      .help(members.map { $0.displayName ?? $0.branch }.joined(separator: " → "))
      Button {
        MacTelemetry.capture(.contextCardUsed(action: .restack))
        run { await actions.restack(session) }
      } label: {
        ContextCardRow(icon: Icon.restack, title: busy ? "Working…" : "Restack")
      }
      .buttonStyle(ContextRowButtonStyle())
      .disabled(busy)
      .help("Rebase every session in the stack onto its parent, and push the ones with pull requests")
      Button {
        MacTelemetry.capture(.contextCardUsed(action: .landStack))
        run { await actions.land(session) }
      } label: {
        ContextCardRow(icon: Icon.landStack, title: "Land Stack…")
      }
      .buttonStyle(ContextRowButtonStyle())
      .disabled(busy)
      .help("Merge the stack bottom-up into \(members.first?.baseBranch ?? "its base")")
    }
    Button {
      MacTelemetry.capture(.contextCardUsed(action: .newStackedSession))
      model.newSessionParent = session
    } label: {
      ContextCardRow(icon: "plus.square.on.square", title: "New Session on Top…")
    }
    .buttonStyle(ContextRowButtonStyle())
    .help("Start a session that branches from \(session.branch)")
    if let note {
      Text(note)
        .font(.scaled(size: 11))
        .foregroundStyle(theme.textSecondary)
        .lineLimit(3)
        .padding(.horizontal, 8)
    }
  }

  private func run(_ work: @escaping () async -> Void) {
    busy = true
    Task {
      await work()
      busy = false
    }
  }
}
