import ArgusCore
import ArgusUI
import SwiftUI

/// One firing and what it wrote — under its automation, or under quick runs
/// when `automationId` is nil. A run is an ordinary session with an ordinary
/// agent in it, so the transcript is one click away.
struct RunScreen: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var host
  @Environment(AutomationsStore.self) private var store
  @Environment(\.theme) private var theme
  let runId: String
  let automationId: String?

  @State private var givingFeedback = false
  @State private var saving = false
  @State private var confirmingDelete = false
  @State private var looked = false

  private var detail: RemoteAutomationRunDetail? { store.detailByRun[runId] }
  /// The list entry follows live events; the detail is only as fresh as its last load.
  private var run: RemoteAutomationRun? { store.runs.first { $0.id == runId } ?? detail?.run }

  private var hostSession: RemoteSession? {
    run?.hostSessionId.flatMap { id in
      host.sessionsByRepo.values.joined().first { $0.id == id } ?? host.adoptedSessions[id]
    }
  }

  var body: some View {
    Group {
      if let run {
        content(run)
      } else if looked {
        EmptyState(
          icon: "questionmark.circle", title: "Run not found",
          body: "Runs are pruned once an automation has fifty of them."
        ) {
          Button(automationId == nil ? "Back to Quick Runs" : "Back to the Automation") { back() }
        }
      } else {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .navigationTitle(run.map { AutomationText.timestamp($0.startedAt) } ?? "Run")
    .navigationSubtitle(run?.automationName ?? "")
    .toolbar { if let run { toolbar(run) } }
    .task {
      await store.loadRun(id: runId)
      looked = true
      // Opening the run is reading its report.
      if run?.unreadReport == true { await store.markRunRead(id: runId) }
    }
    // Every status change brings a new report or cost; a settled run stops changing.
    .task(id: "\(run?.status.rawValue ?? "")\(run?.finishedAt ?? 0)") {
      guard looked else { return }
      await store.loadRun(id: runId)
    }
    // No project lists a run's host session; fetch it so Open Transcript can open it.
    .task(id: run?.hostSessionId) {
      guard let id = run?.hostSessionId, hostSession == nil else { return }
      await host.adoptSession(id: id)
    }
    .sheet(isPresented: $givingFeedback) {
      RunFeedbackSheet(runId: runId).frame(minWidth: 520, minHeight: 360)
    }
    .confirmationDialog("Delete this run?", isPresented: $confirmingDelete) {
      Button("Delete Run", role: .destructive) {
        Task { if await store.deleteRun(id: runId) { back() } }
      }
      Button("Keep It", role: .cancel) {}
    } message: {
      Text("The run, its report and any proposals it raised are removed. This cannot be undone.")
    }
  }

  private func content(_ run: RemoteAutomationRun) -> some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        HStack(spacing: 8) {
          Badge(label: run.status.label, tone: run.status.tone)
          if run.isQuick { Badge(label: "Quick") }
          Text(run.isQuick ? "\(run.triggerReason) · \(run.automationName)" : run.triggerReason)
            .foregroundStyle(theme.textSecondary)
        }
        stats(run)
        if let error = run.error, !error.isEmpty {
          Banner(text: error, tone: .danger).textSelection(.enabled)
        }
        if let error = store.error { Banner(text: error, tone: .danger) }
        Card {
          SectionHeader(title: "Report")
          report(run)
        }
        feedbackLog
      }
      .padding(24)
      .frame(maxWidth: 820, alignment: .leading)
      .frame(maxWidth: .infinity)
    }
  }

  private func stats(_ run: RemoteAutomationRun) -> some View {
    HStack(alignment: .top, spacing: 28) {
      stat("Duration", Labels.runDuration(run))
      stat("Cost", Labels.runCost(run))
      stat("Finished", run.finishedAt.map(AutomationText.timestamp) ?? "—")
      stat("Host session", hostSession.map { $0.displayName ?? $0.branch } ?? "—")
    }
  }

  private func stat(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(label).font(.scaled(.caption)).foregroundStyle(theme.textMuted)
      Text(value).font(.scaled(.title3).weight(.semibold)).monospacedDigit().textSelection(.enabled)
    }
  }

  @ViewBuilder
  private func report(_ run: RemoteAutomationRun) -> some View {
    if let blocks = detail?.reportBlocks, !blocks.isEmpty {
      ReportBlocksView(blocks: blocks) { model.navigate(.inbox) }
    } else if let markdown = detail?.reportMarkdown, !markdown.isEmpty {
      MarkdownView(text: markdown).textSelection(.enabled)
    } else if run.isActive {
      HStack(spacing: 8) {
        ProgressView().controlSize(.small)
        MutedText("The report appears when the run finishes.")
      }
    } else {
      MutedText("This run wrote no report.")
    }
  }

  /// What was argued with, in the user's own words — a corrected report that
  /// doesn't say what corrected it reads like the run just changed its mind.
  @ViewBuilder
  private var feedbackLog: some View {
    if let notes = detail?.feedback, !notes.isEmpty {
      Card {
        SectionHeader(title: "Feedback", count: notes.count)
        ForEach(notes) { entry in
          VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
              MonoText(text: Labels.timeAgo(entry.createdAt), size: 11, color: theme.textMuted)
              if entry.allowClearing { Badge(label: "could remove proposals", tone: .warning) }
            }
            MarkdownView(text: entry.note, baseSize: 13)
          }
        }
      }
    }
  }

  @ToolbarContentBuilder
  private func toolbar(_ run: RemoteAutomationRun) -> some ToolbarContent {
    ToolbarItemGroup {
      // Nothing to resume once the run's session is gone.
      if !run.isActive, run.hostSessionId != nil {
        Button { givingFeedback = true } label: { Label("Give Feedback…", systemImage: "bubble.left") }
          .labelStyle(.titleAndIcon)
      }
      // The playbook and scope come from the run; it lands paused and manual.
      if run.isQuick, !run.isActive {
        Button(saving ? "Saving…" : "Save as Automation") { saveAsAutomation(run) }
          .disabled(saving)
          .help("Create an automation from this run's playbook and scope")
      }
      if let session = hostSession {
        // Straight to the run's agent; a session listed without it still opens on its agents.
        Button { model.navigate(.session(id: session.id, agentId: run.hostAgentId)) } label: {
          Label("Open Transcript", systemImage: "text.bubble")
        }
        .labelStyle(.titleAndIcon)
      }
      if run.isActive {
        Button("Cancel Run") { Task { await store.cancelRun(id: runId) } }
      } else {
        Button("Delete") { confirmingDelete = true }
      }
    }
  }

  private func back() {
    model.navigate(automationId.map { .automation(id: $0, runId: nil) } ?? .quickRun(runId: nil))
  }

  private func saveAsAutomation(_ run: RemoteAutomationRun) {
    saving = true
    Task {
      let id = await store.saveScratchRun(runId: runId, name: run.automationName)
      saving = false
      guard let id else { return }
      model.navigate(.automation(id: id, runId: nil))
    }
  }
}
