package dev.houwert.argus.app.navigation

import androidx.compose.runtime.Composable
import dev.houwert.argus.app.screens.MoreScreen
import dev.houwert.argus.app.screens.PendingScreen
import dev.houwert.argus.app.screens.files.FileScreen
import dev.houwert.argus.app.screens.files.FileSearchScreen
import dev.houwert.argus.app.screens.files.QuickOpenScreen
import dev.houwert.argus.app.screens.home.AgentsScreen
import dev.houwert.argus.app.screens.home.ComputersScreen
import dev.houwert.argus.app.screens.home.HomeScreen
import dev.houwert.argus.app.screens.project.ProjectScreen
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
    is Route.Computer, is Route.Session, is Route.CompareRun,
    is Route.Agent, is Route.StoppedAgent, is Route.Changes, is Route.Timeline, is Route.TurnChanges, is Route.FileDiff,
    is Route.Terminals, is Route.Terminal, is Route.McpServers, is Route.Stashes,
    is Route.Branches, is Route.Branch, is Route.Commit, is Route.BranchCompare, Route.Devices, Route.Inbox, is Route.Proposal,
    Route.PullRequests, Route.Issues, is Route.Issue, is Route.Design, is Route.PullRequest, Route.Automations,
    is Route.Automation, Route.QuickRun, is Route.AutomationEditor, Route.DescribeAutomation, is Route.Run, Route.Blueprints,
    is Route.Blueprint, Route.GenerateBlueprint, is Route.NewProject, Route.Settings, Route.Notifications,
    Route.Account, Route.AddComputer, Route.ClaudeAccounts, Route.Usage, Route.UsagePrices, Route.UsageModels,
    -> PendingScreen(route)
  }
}
