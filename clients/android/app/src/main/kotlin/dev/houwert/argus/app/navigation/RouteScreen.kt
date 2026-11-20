package dev.houwert.argus.app.navigation

import androidx.compose.runtime.Composable
import dev.houwert.argus.app.screens.automations.AutomationEditorScreen
import dev.houwert.argus.app.screens.automations.AutomationScreen
import dev.houwert.argus.app.screens.automations.AutomationsScreen
import dev.houwert.argus.app.screens.automations.DescribeAutomationScreen
import dev.houwert.argus.app.screens.automations.RunScreen
import dev.houwert.argus.app.screens.blueprints.BlueprintEditorScreen
import dev.houwert.argus.app.screens.blueprints.BlueprintsScreen
import dev.houwert.argus.app.screens.blueprints.GenerateBlueprintScreen
import dev.houwert.argus.app.screens.compare.CompareRunScreen
import dev.houwert.argus.app.screens.design.DesignScreen
import dev.houwert.argus.app.screens.inbox.InboxScreen
import dev.houwert.argus.app.screens.inbox.ProposalScreen
import dev.houwert.argus.app.screens.issues.IssueScreen
import dev.houwert.argus.app.screens.issues.IssuesScreen
import dev.houwert.argus.app.screens.MoreScreen
import dev.houwert.argus.app.screens.PendingScreen
import dev.houwert.argus.app.screens.files.FileScreen
import dev.houwert.argus.app.screens.files.FileSearchScreen
import dev.houwert.argus.app.screens.files.QuickOpenScreen
import dev.houwert.argus.app.screens.home.AgentsScreen
import dev.houwert.argus.app.screens.home.ComputersScreen
import dev.houwert.argus.app.screens.home.HomeScreen
import dev.houwert.argus.app.screens.newproject.NewProjectScreen
import dev.houwert.argus.app.screens.project.ProjectScreen
import dev.houwert.argus.app.screens.quickrun.QuickRunScreen
import dev.houwert.argus.app.screens.start.NewSessionScreen
import dev.houwert.argus.app.screens.pair.PairScreen

/**
 * Route to screen, in one place. Wave-2 screens replace their [PendingScreen]
 * branch; the `when` is exhaustive, so a new [Route] case fails to compile until it's mapped.
 */
@Composable
fun RouteScreen(route: Route) {
  when (route) {
    Route.Pair -> PairScreen()
    Route.Projects -> HomeScreen()
    Route.More -> MoreScreen()
    Route.Computers -> ComputersScreen()
    Route.Agents -> AgentsScreen()
    is Route.NewSession -> NewSessionScreen(route.repoRoot)
    is Route.Project -> ProjectScreen(route.repoRoot, route.name)
    is Route.File -> FileScreen(route.sessionId, route.path, route.line)
    is Route.QuickOpen -> QuickOpenScreen(route.sessionId, route.label)
    is Route.FileSearch -> FileSearchScreen(route.sessionId, route.label)
    Route.QuickRun -> QuickRunScreen()
    is Route.NewProject -> NewProjectScreen(route.blueprintId)
    Route.Automations -> AutomationsScreen()
    is Route.Automation -> AutomationScreen(route.id, route.label)
    is Route.AutomationEditor -> AutomationEditorScreen(route.id, route.label)
    Route.DescribeAutomation -> DescribeAutomationScreen()
    is Route.Run -> RunScreen(route.id, route.label)
    Route.Inbox -> InboxScreen()
    is Route.Proposal -> ProposalScreen(route.id)
    Route.Blueprints -> BlueprintsScreen()
    is Route.Blueprint -> BlueprintEditorScreen(route.id)
    Route.GenerateBlueprint -> GenerateBlueprintScreen()
    Route.Issues -> IssuesScreen()
    is Route.Issue -> IssueScreen(route.ref)
    is Route.Design -> DesignScreen(route.url, route.sessionId)
    is Route.CompareRun -> CompareRunScreen(route.groupId)
    is Route.Computer, is Route.Session, is Route.Agent, is Route.StoppedAgent, is Route.Changes, is Route.Timeline,
    is Route.TurnChanges, is Route.FileDiff, is Route.Terminals, is Route.Terminal, is Route.McpServers,
    is Route.Stashes, is Route.Branches, is Route.Branch, is Route.Commit, is Route.BranchCompare, Route.Devices,
    Route.PullRequests, is Route.PullRequest, Route.Settings, Route.Notifications, Route.Account, Route.AddComputer,
    Route.ClaudeAccounts, Route.Usage, Route.UsagePrices, Route.UsageModels,
    -> PendingScreen(route)
  }
}
