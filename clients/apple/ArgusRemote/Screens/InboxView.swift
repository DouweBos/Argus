import ArgusUI
import SwiftUI

/// What the computer's automations want from you, in the Mac's groups: a
/// decision outranks a report, which outranks work in flight, which outranks a
/// run that already failed.
struct InboxView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(ProposalsStore.self) private var proposals
  @Environment(AutomationsStore.self) private var automations
  @Environment(PullRequestsStore.self) private var pullRequests
  /// The failure and cleared windows are relative to now.
  @State private var now = Date()

  private var items: RemoteInboxItems {
    proposals.items(
      runs: automations.runs, sessionIds: Set(host.sessionsByRepo.values.joined().map(\.id)),
      now: now)
  }

  var body: some View {
    List {
      if let error = proposals.error {
        Banner(text: error, tone: .danger).listRowBackground(Color.clear)
      }

      // PRs are the other thing waiting on a decision, and they arrive the
      // same way: while nobody was looking.
      Section {
        NavigationLink(value: Route.pullRequests) {
          HStack(spacing: 8) {
            Label("Pull requests", systemImage: Icon.pullRequests)
            Spacer(minLength: 4)
            if !pullRequests.pullRequests.isEmpty {
              Badge(label: "\(pullRequests.pullRequests.count)", tone: .accent)
            }
          }
        }
        // Only once the computer has Linear connected; the key never leaves it.
        if host.linearConnected {
          NavigationLink(value: Route.issues) {
            Label("Linear issues", systemImage: Icon.issue)
          }
        }
      }

      if !proposals.loaded {
        Loading(label: "Reading the inbox…")
          .listRowBackground(Color.clear)
      } else {
        groups(items)
      }
    }
    .emptyState(when: proposals.loaded && items.isEmpty && proposals.started.isEmpty) {
      EmptyState(
        icon: Icon.inbox,
        title: "Nothing needs you",
        body: "Your automations have nothing waiting on you. This is what a quiet inbox looks like.")
    }
    .navigationTitle("Inbox")
    .refreshable {
      await refresh()
      await pullRequests.refresh()
    }
    .liveRefresh(enabled: host.connection == .ready) { await refresh() }
    .task {
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(60))
        now = Date()
      }
    }
    .task(id: host.connection) {
      guard host.connection == .ready else { return }
      await host.loadIntegrations()
      if !pullRequests.loaded { await pullRequests.refresh() }
    }
  }

  private func refresh() async {
    async let listed: Void = proposals.refresh()
    async let ran: Void = automations.refresh()
    _ = await (listed, ran)
    now = Date()
  }

  @ViewBuilder
  private func groups(_ items: RemoteInboxItems) -> some View {
    // Started from this phone: the card follows it until opened, so the
    // "on it" group doesn't list it twice.
    let local = Set(proposals.started.map(\.id))
    if !items.pending.isEmpty || !proposals.started.isEmpty {
      Section("Decide") {
        ForEach(proposals.started) { proposal in
          StartedProposalCard(
            proposal: proposal,
            onOpen: { openStarted(proposal) },
            onClose: { proposals.closeStarted(id: proposal.id) })
        }
        ForEach(items.pending) { card($0) }
      }
    }
    if !items.reports.isEmpty {
      Section("New reports") {
        ForEach(items.reports) { run in
          InboxRunRow(run: run, icon: Icon.file, tone: .accent)
        }
      }
    }
    let started = items.started.filter { !local.contains($0.id) }
    if !started.isEmpty {
      Section("Argus is on it") {
        ForEach(started) { proposal in
          NavigationLink(
            value: proposal.agentId.map { Route.agent(id: $0, label: proposal.title) }
              ?? .proposal(id: proposal.id)
          ) {
            InboxProposalRow(
              proposal: proposal, icon: Icon.agent, subtitle: proposal.project,
              badge: proposal.status == .autoStarted ? "auto-started" : "in progress")
          }
        }
      }
    }
    if !items.failed.isEmpty {
      Section("Needs a look") {
        ForEach(items.failed) { run in
          InboxRunRow(run: run, icon: Icon.warning, tone: .danger)
            .swipeActions {
              // A failure teaches nothing, so dismissing it asks for no reason.
              if host.hasControl {
                Button("Dismiss") { Task { await automations.dismissRun(id: run.id) } }
              }
            }
        }
      }
    }
    if !items.cleared.isEmpty {
      Section("Argus cleared these") {
        ForEach(items.cleared) { proposal in
          NavigationLink(value: Route.proposal(id: proposal.id)) {
            InboxProposalRow(
              proposal: proposal, icon: Icon.check,
              subtitle: [
                proposal.clearedReason ?? "No reason recorded.", proposal.automationName,
                proposal.clearedAt.map { Labels.timeAgo($0) },
              ].compactMap { $0 }.joined(separator: " · "),
              badge: proposal.status == .superseded ? "replaced" : "withdrawn")
          }
        }
      }
    }
  }

  private func card(_ proposal: RemoteProposal) -> some View {
    ProposalCard(
      proposal: proposal,
      busy: proposals.busy.contains(proposal.id),
      starting: proposals.isStarting(proposal),
      requestError: proposals.requestErrors[proposal.id],
      canDecide: host.hasControl,
      onAccept: { accept(proposal) },
      onCleanup: { Task { await proposals.performCleanup(id: proposal.id) } },
      onDismiss: { reason in
        Task { await proposals.dismiss(id: proposal.id, reason: reason) }
      },
      onResolve: { note in
        Task { await proposals.resolve(id: proposal.id, note: note) }
      },
      onOpenRun: proposal.runId.map { runId in
        {
          Telemetry.capture(.proposalOpenedAsRun)
          router.push(.run(id: runId, label: proposal.automationName))
        }
      },
      onOpenDetails: { router.push(.proposal(id: proposal.id)) })
  }

  /// Go and watch the agent when it came up inside the request; a slower
  /// start shows its progress on the card instead.
  private func accept(_ proposal: RemoteProposal) {
    Task {
      guard let agentId = await proposals.accept(id: proposal.id) else { return }
      router.push(.agent(id: agentId, label: proposal.title))
    }
  }

  private func openStarted(_ proposal: RemoteProposal) {
    guard let agentId = proposal.agentId else { return }
    proposals.closeStarted(id: proposal.id)
    router.push(.agent(id: agentId, label: proposal.title))
  }
}

/// A run the inbox lists: a report to read or a failure to look at.
private struct InboxRunRow: View {
  @Environment(\.theme) private var theme
  let run: RemoteAutomationRun
  let icon: String
  let tone: Tone

  var body: some View {
    NavigationLink(value: Route.run(id: run.id, label: run.automationName)) {
      HStack(spacing: 10) {
        Image(systemName: icon).foregroundStyle(tone == .danger ? theme.error : theme.textSecondary)
        VStack(alignment: .leading, spacing: 2) {
          Text(run.automationName).lineLimit(1)
          Text(run.error ?? run.triggerReason)
            .font(.scaled(.footnote)).foregroundStyle(.secondary).lineLimit(2)
        }
        Spacer(minLength: 6)
        Badge(label: Labels.timeAgo(run.startedAt), tone: tone)
      }
    }
  }
}

/// A proposal that is no longer a decision: started, or cleared by a later run.
private struct InboxProposalRow: View {
  @Environment(\.theme) private var theme
  let proposal: RemoteProposal
  let icon: String
  let subtitle: String?
  let badge: String

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: icon).foregroundStyle(theme.textSecondary)
      VStack(alignment: .leading, spacing: 2) {
        Text(proposal.title).lineLimit(1)
        if let subtitle, !subtitle.isEmpty {
          Text(subtitle).font(.scaled(.footnote)).foregroundStyle(.secondary).lineLimit(2)
        }
      }
      Spacer(minLength: 6)
      Badge(label: badge)
    }
  }
}
