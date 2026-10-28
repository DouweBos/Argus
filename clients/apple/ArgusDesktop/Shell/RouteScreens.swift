import SwiftUI

/// The centre column for the app-wide screens outside a session, so the main
/// window's dispatch stays one line per area.
struct RouteScreen: View {
  let route: DesktopRoute

  static func handles(_ route: DesktopRoute) -> Bool {
    switch route {
    case .automations, .quickRun, .automation, .inbox, .proposal, .notifications, .usage, .issues: true
    default: false
    }
  }

  var body: some View {
    switch route {
    case .automations: AutomationsScreen()
    case .quickRun(let runId): QuickRunScreen(runId: runId)
    case .automation(let id, let runId): AutomationScreen(automationId: id, runId: runId).id(id)
    case .inbox: InboxScreen()
    case .proposal(let id): ProposalScreen(proposalId: id).id(id)
    case .notifications: NotificationsScreen()
    case .usage(let tab, let range): UsageScreen(tab: tab, range: range)
    case .issues: IssuesScreen()
    default: EmptyView()
    }
  }
}
