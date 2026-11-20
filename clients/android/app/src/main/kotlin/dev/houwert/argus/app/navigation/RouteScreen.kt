package dev.houwert.argus.app.navigation

import androidx.compose.runtime.Composable
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
    is Route.Computer, is Route.Session, is Route.CompareRun, is Route.Agent, is Route.StoppedAgent, is Route.Timeline, is Route.Terminals, is Route.Terminal, is Route.McpServers, Route.Devices, Route.Inbox, is Route.Proposal, Route.Issues, is Route.Issue, is Route.Design, Route.Automations, is Route.Automation, is Route.AutomationEditor, Route.DescribeAutomation, is Route.Run, Route.Blueprints, is Route.Blueprint, Route.GenerateBlueprint, Route.Settings,
    Route.Account, Route.AddComputer, Route.ClaudeAccounts, Route.Usage, Route.UsagePrices, Route.UsageModels,
    -> PendingScreen(route)
  }
}
