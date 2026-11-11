import ArgusCore
import SwiftUI

/// The centre column for the app-wide screens outside a session, so the main
/// window's dispatch stays one line per area.
struct RouteScreen: View {
  let route: DesktopRoute

  static func handles(_ route: DesktopRoute) -> Bool {
    switch route {
    case .automations, .quickRun, .describeAutomation, .automation, .inbox, .proposal, .notifications, .usage, .usageModel, .usagePrices, .issues, .design: true
    default: false
    }
  }

  var body: some View {
    switch route {
    case .automations: AutomationsScreen()
    case .describeAutomation: AutomationsScreen(describing: true)
    case .quickRun(let runId): QuickRunScreen(runId: runId)
    case .automation(let id, let runId): AutomationScreen(automationId: id, runId: runId).id(id)
    case .inbox: InboxScreen()
    case .proposal(let id): ProposalScreen(proposalId: id).id(id)
    case .notifications: NotificationsScreen()
    case .usage(let tab, let range): UsageScreen(tab: tab, range: range)
    case .usageModel(let tab, let runner, let model, let range):
      UsageModelScreen(tab: tab, key: UsageModelKey(runner: runner, model: model), range: range)
    case .usagePrices: UsagePricesScreen()
    case .issues(let scope, let issue, let query): IssuesScreen(scope: scope, issueRef: issue, query: query)
    case .design(let url, let sessionId): DesignScreen(url: url, sessionId: sessionId).id("\(url)|\(sessionId ?? "")")
    default: EmptyView()
    }
  }
}
