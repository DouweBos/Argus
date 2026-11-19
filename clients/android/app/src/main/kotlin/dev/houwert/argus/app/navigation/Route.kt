package dev.houwert.argus.app.navigation

import dev.houwert.argus.kit.protocol.generated.RemoteGitBranch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Every screen a stack can push, as the iPhone's `Route`. One case per screen,
 * carrying exactly what that screen needs to load itself, so a notification
 * or deep link can build a destination without knowing anything else.
 *
 * Adding a screen: add a case here, then its branch in [RouteScreen]. Fields
 * must be serializable: a route travels through the NavHost as JSON.
 */
@Serializable
sealed interface Route {
  @Serializable data object Pair : Route
  @Serializable data class Computer(val deviceId: String) : Route
  @Serializable data object Projects : Route
  /** Every agent across projects, as the desktop's `/agents`. */
  @Serializable data object Agents : Route
  @Serializable data class Project(val repoRoot: String, val name: String) : Route
  /** One session: its agents as tabs, its tools in a details sheet. */
  @Serializable data class Session(val id: String, val label: String, val repoRoot: String) : Route
  /** The start composer on a new worktree; null opens on the last active project. */
  @Serializable data class NewSession(val repoRoot: String? = null) : Route
  @Serializable data class CompareRun(val groupId: String) : Route
  /** The session screen, opened on one agent before its session is known. */
  @Serializable data class Agent(val id: String, val label: String) : Route
  @Serializable data class StoppedAgent(val historyId: String, val repoRoot: String, val label: String, val branch: String, val runnerSessionId: String) : Route
  @Serializable data class Changes(val sessionId: String, val label: String) : Route
  @Serializable data class Timeline(val sessionId: String, val label: String) : Route
  @Serializable data class TurnChanges(val sessionId: String, val label: String, val checkpointId: String) : Route
  /** One changed file's diff; [mode] is the Changes screen's `branch` or `working`. */
  @Serializable data class FileDiff(val sessionId: String, val path: String, val mode: String) : Route
  @Serializable data class QuickOpen(val sessionId: String, val label: String) : Route
  @Serializable data class FileSearch(val sessionId: String, val label: String) : Route
  @Serializable data class Terminals(val sessionId: String, val label: String) : Route
  @Serializable data class Terminal(val id: String, val label: String) : Route
  @Serializable data class McpServers(val agentId: String) : Route
  @Serializable data class Stashes(val sessionId: String, val label: String) : Route
  @Serializable data class Branches(val sessionId: String, val repoRoot: String, val label: String) : Route
  @Serializable data class Branch(val sessionId: String, val repoRoot: String, val branch: RemoteGitBranch) : Route
  @Serializable data class Commit(val sessionId: String, val hash: String, val subject: String) : Route
  @Serializable data class BranchCompare(val sessionId: String, val left: String, val right: String) : Route
  @Serializable data object Devices : Route
  @Serializable data object Inbox : Route
  @Serializable data class Proposal(val id: String) : Route
  @Serializable data object PullRequests : Route
  @Serializable data object Issues : Route
  @Serializable data class Issue(val ref: String) : Route
  @Serializable data class Design(val url: String, val sessionId: String? = null) : Route
  @Serializable data class PullRequest(val repo: String, val number: Int, val label: String) : Route
  @Serializable data object Automations : Route
  @Serializable data class Automation(val id: String, val label: String) : Route
  @Serializable data object QuickRun : Route
  /** Null id creates a new automation. */
  @Serializable data class AutomationEditor(val id: String? = null, val label: String) : Route
  @Serializable data object DescribeAutomation : Route
  @Serializable data class Run(val id: String, val label: String) : Route
  @Serializable data object Blueprints : Route
  @Serializable data class Blueprint(val id: String? = null) : Route
  @Serializable data object GenerateBlueprint : Route
  @Serializable data class NewProject(val blueprintId: String? = null) : Route
  @Serializable data object Settings : Route
  /** One Settings sub-page, by its `SettingsPane` raw value. */
  @Serializable data class SettingsPage(val pane: String) : Route
  @Serializable data object Notifications : Route
  @Serializable data object Computers : Route
  @Serializable data object Account : Route
  @Serializable data object AddComputer : Route
  @Serializable data object ClaudeAccounts : Route
  @Serializable data object Usage : Route
  @Serializable data object UsagePrices : Route
  @Serializable data object UsageModels : Route
  /** The phone's fifth tab: every destination without a tab of its own. */
  @Serializable data object More : Route

  companion object {
    private val json = Json { ignoreUnknownKeys = true }

    fun encode(route: Route): String = json.encodeToString(serializer(), route)

    fun decode(text: String): Route? = runCatching { json.decodeFromString(serializer(), text) }.getOrNull()
  }
}
