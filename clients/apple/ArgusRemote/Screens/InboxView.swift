import ArgusUI
import SwiftUI

/// What the computer's automations want you to decide.
///
/// The decisions are the half of the inbox worth having on a phone: they
/// arrive while nobody is looking, and answering one is a tap.
struct InboxView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(ProposalsStore.self) private var proposals
  @Environment(PullRequestsStore.self) private var pullRequests

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
            Label("Pull requests", systemImage: Icon.repo)
            Spacer(minLength: 4)
            if !pullRequests.pullRequests.isEmpty {
              Badge(label: "\(pullRequests.pullRequests.count)", tone: .accent)
            }
          }
        }
      }

      if !proposals.loaded {
        Loading(label: "Reading the inbox…")
          .listRowBackground(Color.clear)
      } else if proposals.proposals.isEmpty && proposals.started.isEmpty {
        EmptyState(
          icon: Icon.envelope,
          title: "Nothing needs you",
          body: "When an automation finds something worth deciding on, it shows up here.")
        .listRowBackground(Color.clear)
      } else {
        Section("Decide") {
          ForEach(proposals.started) { proposal in
            StartedProposalCard(
              proposal: proposal,
              onOpen: { openStarted(proposal) },
              onClose: { proposals.closeStarted(id: proposal.id) })
          }
          ForEach(proposals.proposals) { proposal in
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
        }
      }
    }
    .navigationTitle("Inbox")
    .refreshable {
      await proposals.refresh()
      await pullRequests.refresh()
    }
    .liveRefresh(enabled: host.connection == .ready) { await proposals.refresh() }
    .task(id: host.connection) {
      guard host.connection == .ready, !pullRequests.loaded else { return }
      await pullRequests.refresh()
    }
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
