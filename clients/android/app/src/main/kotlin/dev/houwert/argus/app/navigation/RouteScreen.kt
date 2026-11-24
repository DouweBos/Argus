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
import dev.houwert.argus.app.screens.git.BranchCompareScreen
import dev.houwert.argus.app.screens.git.BranchScreen
import dev.houwert.argus.app.screens.git.BranchesScreen
import dev.houwert.argus.app.screens.git.ChangesScreen
import dev.houwert.argus.app.screens.git.CommitScreen
import dev.houwert.argus.app.screens.git.FileDiffScreen
import dev.houwert.argus.app.screens.git.PullRequestScreen
import dev.houwert.argus.app.screens.git.PullRequestsScreen
import dev.houwert.argus.app.screens.git.ReviewGuideScreen
import dev.houwert.argus.app.screens.git.StashesScreen
import dev.houwert.argus.app.screens.git.WarningsScreen
import dev.houwert.argus.app.screens.account.AccountScreen
import dev.houwert.argus.app.screens.account.AddComputerScreen
import dev.houwert.argus.app.screens.accounts.ClaudeAccountsScreen
import dev.houwert.argus.app.screens.computers.ComputerScreen
import dev.houwert.argus.app.screens.devices.DeviceScreen
import dev.houwert.argus.app.screens.devices.DevicesScreen
import dev.houwert.argus.app.screens.files.FileScreen
import dev.houwert.argus.app.screens.files.FileSearchScreen
import dev.houwert.argus.app.screens.files.QuickOpenScreen
import dev.houwert.argus.app.screens.home.AgentsScreen
import dev.houwert.argus.app.screens.home.ComputersScreen
import dev.houwert.argus.app.screens.home.HomeScreen
import dev.houwert.argus.app.screens.agent.McpServersScreen
import dev.houwert.argus.app.screens.newproject.NewProjectScreen
import dev.houwert.argus.app.screens.pair.PairScreen
import dev.houwert.argus.app.screens.project.ProjectScreen
import dev.houwert.argus.app.screens.quickrun.QuickRunScreen
import dev.houwert.argus.app.screens.settings.SettingsPaneScreen
import dev.houwert.argus.app.screens.settings.SettingsScreen
import dev.houwert.argus.app.screens.start.NewSessionScreen
import dev.houwert.argus.app.screens.pair.PairScreen
import dev.houwert.argus.app.screens.session.SessionScreen
import dev.houwert.argus.app.screens.session.SessionTimelineScreen
import dev.houwert.argus.app.screens.session.StoppedAgentScreen
import dev.houwert.argus.app.screens.teammates.TeammateDutiesScreen
import dev.houwert.argus.app.screens.teammates.TeammateGalleryScreen
import dev.houwert.argus.app.screens.teammates.TeammateMemoryScreen
import dev.houwert.argus.app.screens.teammates.TeammateProfileScreen
import dev.houwert.argus.app.screens.teammates.TeammateScreen
import dev.houwert.argus.app.screens.teammates.TeammatesScreen
import dev.houwert.argus.app.screens.terminals.TerminalScreen
import dev.houwert.argus.app.screens.terminals.TerminalsScreen
import dev.houwert.argus.app.screens.usage.UsageModelScreen
import dev.houwert.argus.app.screens.usage.UsageModelsScreen
import dev.houwert.argus.app.screens.usage.UsagePricesScreen
import dev.houwert.argus.app.screens.usage.UsageScreen

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
    is Route.Session, is Route.Agent -> SessionScreen(route)
    is Route.StoppedAgent -> StoppedAgentScreen(route)
    is Route.Timeline -> SessionTimelineScreen(route)
    is Route.Terminals -> TerminalsScreen(route)
    is Route.Terminal -> TerminalScreen(route)
    is Route.McpServers -> McpServersScreen(route)
    is Route.Changes -> ChangesScreen(route.sessionId, route.label)
    is Route.TurnChanges -> ChangesScreen(route.sessionId, route.label, "turn:${route.checkpointId}")
    is Route.FileDiff -> FileDiffScreen(route.sessionId, route.path, route.mode)
    is Route.Stashes -> StashesScreen(route.sessionId, route.label)
    is Route.Branches -> BranchesScreen(route.sessionId, route.repoRoot, route.label)
    is Route.Branch -> BranchScreen(route.sessionId, route.repoRoot, route.branch)
    is Route.Commit -> CommitScreen(route.sessionId, route.hash, route.subject)
    is Route.BranchCompare -> BranchCompareScreen(route.sessionId, route.left, route.right)
    Route.PullRequests -> PullRequestsScreen()
    is Route.PullRequest -> PullRequestScreen(route.repo, route.number, route.label)
    is Route.ReviewGuide -> ReviewGuideScreen(route.target, route.label)
    Route.Notifications -> WarningsScreen()
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
    Route.Teammates -> TeammatesScreen()
    Route.TeammateGallery -> TeammateGalleryScreen()
    is Route.Teammate -> TeammateScreen(route.id, route.label, route.threadId)
    is Route.TeammateProfile -> TeammateProfileScreen(route.id, route.label)
    is Route.TeammateDuties -> TeammateDutiesScreen(route.id, route.label)
    is Route.TeammateMemory -> TeammateMemoryScreen(route.id, route.label)
    Route.Inbox -> InboxScreen()
    is Route.Proposal -> ProposalScreen(route.id)
    Route.Blueprints -> BlueprintsScreen()
    is Route.Blueprint -> BlueprintEditorScreen(route.id)
    Route.GenerateBlueprint -> GenerateBlueprintScreen()
    Route.Issues -> IssuesScreen()
    is Route.Issue -> IssueScreen(route.ref)
    is Route.Design -> DesignScreen(route.url, route.sessionId)
    is Route.CompareRun -> CompareRunScreen(route.groupId)
    Route.Account -> AccountScreen()
    Route.AddComputer -> AddComputerScreen()
    Route.Settings -> SettingsScreen()
    is Route.SettingsPage -> SettingsPaneScreen(route.pane)
    is Route.Computer -> ComputerScreen(route.deviceId)
    Route.ClaudeAccounts -> ClaudeAccountsScreen()
    Route.Devices -> DevicesScreen()
    is Route.Device -> DeviceScreen(route)
    Route.Usage -> UsageScreen()
    is Route.UsageModel -> UsageModelScreen(route)
    Route.UsagePrices -> UsagePricesScreen()
    Route.UsageModels -> UsageModelsScreen()
  }
}
