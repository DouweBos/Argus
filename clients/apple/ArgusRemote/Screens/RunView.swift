import ArgusUI
import SwiftUI

/// One firing: how it went, what it cost, and the report it wrote.
///
/// A run is an ordinary session with an ordinary agent in it, so the
/// transcript is one tap away — that is where you go when the report doesn't
/// answer the question.
struct RunView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(AutomationsStore.self) private var store

  let runId: String
  let label: String

  /// The name being typed while promoting a quick run; nil when not saving.
  @State private var savingName: String?
  @State private var givingFeedback = false
  @State private var opening = false
  @State private var confirmingDelete = false

  private var detail: RemoteAutomationRunDetail? { store.detailByRun[runId] }
  private var run: RemoteAutomationRun? {
    detail?.run ?? store.runs.first { $0.id == runId }
  }

  var body: some View {
    Screen {
      if let run {
        summary(run)
        report
        feedbackLog
      } else {
        Loading(label: "Reading the run…")
      }
    }
    .navigationTitle(label)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if host.hasControl, let run, !run.isActive {
        ToolbarItem(placement: .topBarTrailing) {
          Button(role: .destructive) { confirmingDelete = true } label: {
            Label("Delete run", systemImage: Icon.trash)
          }
        }
      }
    }
    .alert("Delete this run?", isPresented: $confirmingDelete) {
      Button("Cancel", role: .cancel) {}
      Button("Delete", role: .destructive) {
        Task {
          guard await store.deleteRunOverGateway(id: runId) else { return }
          router.pop()
        }
      }
    } message: {
      Text("Its record, its report and the proposals it raised go for good.")
    }
    .task {
      await store.loadRun(id: runId)
      // Opening a report clears its unread dot on the computer too.
      await store.markRunRead(id: runId)
    }
    // A settled run's report never changes, so stop asking.
    .liveRefresh(enabled: host.connection == .ready && (run?.isActive ?? true)) {
      await store.loadRun(id: runId)
    }
    .sheet(isPresented: $givingFeedback) {
      RunFeedbackSheet(runId: runId)
    }
    .alert(
      "Save as automation",
      isPresented: Binding(
        get: { savingName != nil },
        set: { if !$0 { savingName = nil } })
    ) {
      TextField(
        "Name",
        text: Binding(get: { savingName ?? "" }, set: { savingName = $0 }))
      Button("Cancel", role: .cancel) { savingName = nil }
      Button("Save") { saveAsAutomation() }
    } message: {
      Text("Keeps the playbook and scope. It's saved paused, with no schedule.")
    }
  }

  @ViewBuilder

  /// The run's agent, resumed from its saved chat once it has stopped (control only),
  /// so the button lands on a live agent rather than a dead end.
  private func openAgent(_ agentId: String, run: RemoteAutomationRun) {
    guard host.hasControl, let sessionId = run.hostSessionId else {
      return router.push(.agent(id: agentId, label: run.automationName))
    }
    opening = true
    Task {
      defer { opening = false }
      if host.session(id: sessionId) == nil { await host.adoptSession(id: sessionId) }
      var opened: String?
      if let session = host.session(id: sessionId) { opened = await host.openAgent(agentId, in: session)?.agentId }
      router.push(.agent(id: opened ?? agentId, label: run.automationName))
    }
  }
  private func summary(_ run: RemoteAutomationRun) -> some View {
    Card {
      HStack(spacing: 8) {
        Badge(label: run.status.label, tone: run.status.tone)
        if run.isQuick { Badge(label: "Quick") }
        Spacer(minLength: 6)
      }
      MutedText(run.triggerReason)

      RunFigures([
        ("Started", Labels.timeAgo(run.startedAt)), ("Duration", Labels.runDuration(run)),
        ("Cost", Labels.runCost(run)),
      ])

      if let error = run.error, !error.isEmpty {
        Banner(text: error, tone: .danger)
      }

      FlowRow(spacing: 8) {
        if let agentId = run.hostAgentId {
          Btn(label: opening ? "Opening…" : "Open agent", tone: .secondary, small: true, icon: Icon.agent) {
            openAgent(agentId, run: run)
          }
          .disabled(opening)
        }
        if host.hasControl, run.isActive {
          Btn(label: "Cancel", tone: .danger, small: true) {
            Task { await store.cancelRun(id: runId) }
          }
        }
        // Nothing to resume once the run's session is gone.
        if host.hasControl, !run.isActive, run.hostSessionId != nil {
          Btn(label: "Give feedback", tone: .secondary, small: true, icon: Icon.chat) {
            givingFeedback = true
          }
        }
        // A one-off that turned out to be worth keeping.
        if host.hasControl, run.isQuick, !run.isActive {
          Btn(label: "Save as automation", tone: .secondary, small: true) {
            savingName = run.automationName
          }
        }
      }
    }
  }

  private func saveAsAutomation() {
    guard let name = savingName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty
    else { return }
    savingName = nil
    Task {
      guard let id = await store.saveScratchRun(runId: runId, name: name) else { return }
      router.push(.automationEditor(id: id, label: name))
    }
  }

  /// In a card under its header, as on the Mac.
  @ViewBuilder
  private var report: some View {
    if detail != nil || run?.isActive == true {
      Card {
        SectionHeader(title: "Report")
        if let blocks = detail?.reportBlocks, !blocks.isEmpty {
          ReportBlocksView(blocks: blocks, onOpenInbox: { router.push(.inbox) })
        } else if let markdown = detail?.reportMarkdown, !markdown.isEmpty {
          MarkdownView(text: markdown)
        } else if run?.isActive == true {
          HStack(spacing: 8) {
            ProgressView().controlSize(.small)
            MutedText("The report appears when the run finishes.")
          }
        } else {
          MutedText("This run wrote no report.")
        }
      }
    }
  }

  /// What was argued with, in the user's own words. A corrected report that
  /// does not say what corrected it reads like the run just changed its mind.
  @ViewBuilder
  private var feedbackLog: some View {
    if let notes = detail?.feedback, !notes.isEmpty {
      Card {
        SectionHeader(title: "Feedback", count: notes.count)
        ForEach(notes) { entry in
          VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
              MonoText(text: Labels.timeAgo(entry.createdAt), size: 11, color: theme.textMuted)
              if entry.allowClearing {
                Badge(label: "could remove proposals", tone: .warning)
              }
            }
            MarkdownView(text: entry.note)
          }
        }
      }
    }
  }
}
