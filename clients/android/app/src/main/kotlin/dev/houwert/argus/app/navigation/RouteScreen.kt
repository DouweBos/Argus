package dev.houwert.argus.app.navigation

import androidx.compose.runtime.Composable
import dev.houwert.argus.app.screens.MoreScreen
import dev.houwert.argus.app.screens.PendingScreen
import dev.houwert.argus.app.screens.accounts.ClaudeAccountsScreen
import dev.houwert.argus.app.screens.computers.ComputerScreen
import dev.houwert.argus.app.screens.devices.DeviceScreen
import dev.houwert.argus.app.screens.devices.DevicesScreen
import dev.houwert.argus.app.screens.home.HomeScreen
import dev.houwert.argus.app.screens.pair.PairScreen
import dev.houwert.argus.app.screens.settings.SettingsPaneScreen
import dev.houwert.argus.app.screens.settings.SettingsScreen

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
    Route.Settings -> SettingsScreen()
    is Route.SettingsPage -> SettingsPaneScreen(route.pane)
    is Route.Computer -> ComputerScreen(route.deviceId)
    Route.ClaudeAccounts -> ClaudeAccountsScreen()
    Route.Devices -> DevicesScreen()
    is Route.Device -> DeviceScreen(route)
    Route.Agents, is Route.Project, is Route.Session, is Route.NewSession, is Route.CompareRun,
    is Route.Agent, is Route.StoppedAgent, is Route.Changes, is Route.Timeline, is Route.TurnChanges, is Route.FileDiff,
    is Route.QuickOpen, is Route.FileSearch, is Route.Terminals, is Route.Terminal, is Route.McpServers, is Route.Stashes,
    is Route.Branches, is Route.Branch, is Route.Commit, is Route.BranchCompare, Route.Inbox, is Route.Proposal,
    Route.PullRequests, Route.Issues, is Route.Issue, is Route.Design, is Route.PullRequest, Route.Automations,
    is Route.Automation, Route.QuickRun, is Route.AutomationEditor, Route.DescribeAutomation, is Route.Run, Route.Blueprints,
    is Route.Blueprint, Route.GenerateBlueprint, is Route.NewProject, Route.Notifications, Route.Computers,
    Route.Account, Route.AddComputer, Route.Usage, Route.UsagePrices, Route.UsageModels,
    -> PendingScreen(route)
  }
}
