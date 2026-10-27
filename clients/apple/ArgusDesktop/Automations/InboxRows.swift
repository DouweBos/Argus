import ArgusCore
import ArgusUI
import SwiftUI

/// An inbox line: what it is, one line of why, a badge, and its own action.
private struct InboxRow<Actions: View>: View {
  @Environment(\.theme) private var theme
  let icon: String
  var alert = false
  let title: String
  let subtitle: String
  let badge: Badge
  let open: () -> Void
  @ViewBuilder let actions: () -> Actions

  var body: some View {
    Card(tone: alert ? .danger : nil) {
      HStack(spacing: 10) {
        Image(systemName: icon).foregroundStyle(alert ? theme.error : theme.textSecondary)
        Button(action: open) {
          VStack(alignment: .leading, spacing: 2) {
            Text(title).fontWeight(.medium).lineLimit(1)
            Text(subtitle).font(.scaled(.caption)).foregroundStyle(theme.textSecondary).lineLimit(2)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        badge
        actions()
      }
    }
  }
}

/// A finished run with a report nobody has opened yet.
struct ReportRow: View {
  @Environment(DesktopModel.self) private var model
  let run: ArgusProtocol.AutomationRun

  var body: some View {
    InboxRow(
      icon: "doc.text", title: name, subtitle: run.reportPreview,
      badge: Badge(label: Labels.timeAgo(run.startedAt)),
      open: { AutomationActions.openRun(model, automationId: run.automationId, runId: run.id) }
    ) {
      Button("Mark Read") { Task { await model.inbox.markRunRead(id: run.id) } }
    }
  }

  private var name: String {
    run.scratch?.name ?? model.automations.automations.first { $0.id == run.automationId }?.name
      ?? "Quick run"
  }
}

/// A run that didn't finish — the automation itself needs attention.
struct FailedRow: View {
  @Environment(DesktopModel.self) private var model
  let run: ArgusProtocol.AutomationRun

  var body: some View {
    InboxRow(
      icon: "exclamationmark.triangle", alert: true,
      title: run.scratch?.name
        ?? model.automations.automations.first { $0.id == run.automationId }?.name
        ?? "Deleted automation",
      subtitle: run.error ?? "No error recorded.",
      badge: Badge(label: Labels.timeAgo(run.startedAt), tone: .danger),
      open: { AutomationActions.openRun(model, automationId: run.automationId, runId: run.id) }
    ) {
      // A failure teaches nothing, so dismissing it asks for no reason.
      Button("Dismiss") { Task { await model.inbox.markRunRead(id: run.id) } }
    }
  }
}

/// Work Argus started off a proposal, for information and a way in.
struct StartedRow: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var host
  let proposal: ArgusProtocol.Proposal

  private var session: RemoteSession? {
    proposal.sessionId.flatMap { id in host.sessionsByRepo.values.joined().first { $0.id == id } }
  }

  var body: some View {
    InboxRow(
      icon: "sparkles", title: proposal.title,
      subtitle: session.map {
        "\(AutomationText.project($0.repoRoot) ?? "") · \($0.displayName ?? $0.branch)"
      } ?? "",
      badge: Badge(label: proposal.status == .autoStarted ? "auto-started" : "in progress"),
      open: open
    ) {
      Button("Open", action: open)
    }
  }

  private func open() {
    guard let id = proposal.sessionId else { return }
    model.openAgents(session: id)
  }
}

/// Taken off your hands by a later run — listed so a proposal never just
/// vanishes unexplained.
struct ClearedRow: View {
  @Environment(DesktopModel.self) private var model
  let proposal: ArgusProtocol.Proposal

  var body: some View {
    InboxRow(
      icon: "checkmark", title: proposal.title, subtitle: subtitle,
      badge: Badge(label: proposal.status == .superseded ? "replaced" : "withdrawn"),
      open: { model.navigate(.proposal(id: proposal.id)) }
    ) {
      EmptyView()
    }
  }

  private var subtitle: String {
    var parts = [proposal.clearedReason ?? "No reason recorded."]
    if let name = model.automations.automations.first(where: { $0.id == proposal.automationId })?.name {
      parts.append(name)
    }
    if let at = proposal.clearedAt { parts.append(Labels.timeAgo(at)) }
    return parts.joined(separator: " · ")
  }
}
