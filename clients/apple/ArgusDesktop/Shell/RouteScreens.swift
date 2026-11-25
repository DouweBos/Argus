import ArgusCore
import SwiftUI

/// The centre column for the app-wide screens outside a session, so the main
/// window's dispatch stays one line per area.
struct RouteScreen: View {
  let route: DesktopRoute

  static func handles(_ route: DesktopRoute) -> Bool {
    switch route {
    case .automations, .quickRun, .describeAutomation, .upcomingRuns, .automation, .teammates, .teammateGallery, .teammate, .inbox, .proposal, .notifications, .usage, .usageModel,
      .usagePrices, .usageModels, .issues, .design, .compareRun, .blueprints, .blueprint, .generateBlueprint, .newProject:
      true
    default: false
    }
  }

  var body: some View {
    switch route {
    case .automations: AutomationsScreen()
    case .describeAutomation: AutomationsScreen(describing: true)
    case .upcomingRuns: UpcomingScreen()
    case .quickRun(let runId): QuickRunScreen(runId: runId)
    case .automation(let id, let runId): AutomationScreen(automationId: id, runId: runId).id(id)
    case .teammates: TeammatesScreen()
    case .teammateGallery: TeammateGalleryScreen()
    case .teammate(let id, let page): TeammateScreen(teammateId: id, page: page).id(id)
    case .blueprints: BlueprintsScreen()
    case .newProject(let blueprintId): BlueprintsScreen(newProject: true, blueprintId: blueprintId).id(blueprintId)
    case .blueprint(let id): BlueprintScreen(blueprintId: id).id(id)
    case .generateBlueprint: GenerateBlueprintScreen()
    case .inbox(let filter): InboxScreen(filter: filter)
    case .proposal(let id): ProposalScreen(proposalId: id).id(id)
    case .notifications: NotificationsScreen()
    case .archivedSessions: ArchivedSessionsScreen()
    case .usage(let tab, let range): UsageScreen(tab: tab, range: range)
    case .usageModel(let tab, let runner, let model, let range):
      UsageModelScreen(tab: tab, key: UsageModelKey(runner: runner, model: model), range: range)
    case .usagePrices: UsagePricesScreen()
    case .usageModels: UsageModelsScreen()
    case .issues(let scope, let issue, let query): IssuesScreen(scope: scope, issueRef: issue, query: query)
    case .design(let url, let sessionId): DesignScreen(url: url, sessionId: sessionId).id("\(url)|\(sessionId ?? "")")
    case .compareRun(let groupId): CompareRunView(groupId: groupId).id(groupId)
    default: EmptyView()
    }
  }
}
