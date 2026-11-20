package dev.houwert.argus.app.navigation

import androidx.compose.runtime.Composable
import dev.houwert.argus.app.screens.MoreScreen
import dev.houwert.argus.app.screens.PendingScreen
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
import dev.houwert.argus.app.screens.newproject.NewProjectScreen
import dev.houwert.argus.app.screens.pair.PairScreen
import dev.houwert.argus.app.screens.project.ProjectScreen
import dev.houwert.argus.app.screens.quickrun.QuickRunScreen
import dev.houwert.argus.app.screens.settings.SettingsPaneScreen
import dev.houwert.argus.app.screens.settings.SettingsScreen
import dev.houwert.argus.app.screens.start.NewSessionScreen
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
    Route.Computers -> ComputersScreen()
    Route.Agents -> AgentsScreen()
    is Route.NewSession -> NewSessionScreen(route.repoRoot)
    is Route.Project -> ProjectScreen(route.repoRoot, route.name)
    is Route.File -> FileScreen(route.sessionId, route.path, route.line)
    is Route.QuickOpen -> QuickOpenScreen(route.sessionId, route.label)
    is Route.FileSearch -> FileSearchScreen(route.sessionId, route.label)
    Route.QuickRun -> QuickRunScreen()
    is Route.NewProject -> NewProjectScreen(route.blueprintId)
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
    is Route.Session, is Route.CompareRun, is Route.Agent, is Route.StoppedAgent, is Route.Changes, is Route.Timeline,
    is Route.TurnChanges, is Route.FileDiff, is Route.Terminals, is Route.Terminal, is Route.McpServers, is Route.Stashes,
    is Route.Branches, is Route.Branch, is Route.Commit, is Route.BranchCompare, Route.Inbox, is Route.Proposal,
    Route.PullRequests, Route.Issues, is Route.Issue, is Route.Design, is Route.PullRequest, Route.Automations,
    is Route.Automation, is Route.AutomationEditor, Route.DescribeAutomation, is Route.Run, Route.Blueprints,
    is Route.Blueprint, Route.GenerateBlueprint, Route.Notifications, Route.Account, Route.AddComputer,
    -> PendingScreen(route)
  }
}
