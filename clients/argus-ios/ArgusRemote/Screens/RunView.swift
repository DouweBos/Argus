import ArgusKit
import SwiftUI

/// One firing: how it went, what it cost, and the report it wrote.
///
/// A run is an ordinary session with an ordinary agent in it, so the
/// transcript is one tap away — that is where you go when the report doesn't
/// answer the question.
struct RunView: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(Router.self) private var router
  @Environment(AutomationsStore.self) private var store

  let runId: String
  let label: String

  private var detail: RemoteAutomationRunDetail? { store.detailByRun[runId] }
  private var run: RemoteAutomationRun? {
    detail?.run ?? store.runs.first { $0.id == runId }
  }

  var body: some View {
    Screen {
      if let run {
        summary(run)
        report
      } else {
        Loading(label: "Reading the run…")
      }
    }
    .navigationTitle(label)
    .navigationBarTitleDisplayMode(.inline)
    .task {
      await store.loadRun(id: runId)
      // Opening a report clears its unread dot on the computer too.
      await store.markRunRead(id: runId)
    }
    // A settled run's report never changes, so stop asking.
    .liveRefresh(enabled: app.connection == .ready && (run?.isActive ?? true)) {
      await store.loadRun(id: runId)
    }
  }

  @ViewBuilder
  private func summary(_ run: RemoteAutomationRun) -> some View {
    Card {
      HStack(spacing: 8) {
        Badge(label: run.status.rawValue, tone: run.status.tone)
        if run.isQuick { Badge(label: "quick") }
        Spacer(minLength: 6)
      }
      MutedText(run.triggerReason)

      HStack(spacing: 16) {
        figure("Started", Labels.timeAgo(run.startedAt))
        figure("Duration", Labels.runDuration(run))
        figure("Cost", Labels.runCost(run))
      }

      if let error = run.error, !error.isEmpty {
        Banner(text: error, tone: .danger)
      }

      HStack(spacing: 8) {
        if let agentId = run.hostAgentId {
          Btn(label: "Open agent", tone: .secondary, small: true, icon: Icon.agent) {
            router.push(.agent(id: agentId, label: run.automationName))
          }
        }
        if app.hasControl, run.isActive {
          Btn(label: "Cancel", tone: .danger, small: true) {
            Task { await store.cancelRun(id: runId) }
          }
        }
      }
    }
  }

  private func figure(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(label).font(.system(size: 10)).foregroundStyle(theme.textMuted)
      MonoText(text: value, size: 13, color: theme.text)
    }
  }

  @ViewBuilder
  private var report: some View {
    if let blocks = detail?.reportBlocks, !blocks.isEmpty {
      SectionHeader(title: "Report")
      ReportBlocksView(blocks: blocks)
    } else if let markdown = detail?.reportMarkdown, !markdown.isEmpty {
      SectionHeader(title: "Report")
      MarkdownView(text: markdown)
    } else if detail != nil {
      MutedText("This run wrote no report.")
    }
  }
}
