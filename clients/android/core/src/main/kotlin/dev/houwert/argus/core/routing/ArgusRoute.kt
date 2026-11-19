package dev.houwert.argus.core.routing

import dev.houwert.argus.kit.protocol.generated.LinearIssueScope
import dev.houwert.argus.kit.protocol.generated.UsageRange

/**
 * A screen as `docs/routing.md` spells it. The single source of truth for which screen shows:
 * navigate by [path], read it back with [ArgusRoute.parse]. Equality is structural, so "which item
 * is selected" is a route comparison.
 */
sealed interface ArgusRoute {
  data object Home : ArgusRoute
  /** `/agents`: every agent across every session. */
  data object Agents : ArgusRoute
  /** `/runtimes`: every run command's terminal across every session. */
  data object Runtimes : ArgusRoute
  /** `/devices`: every simulator, emulator and browser the host knows. */
  data object Devices : ArgusRoute
  /** `/devices/:platform/:deviceKey`: the devices screen with one device's details open. */
  data class Device(val platform: String, val deviceKey: String) : ArgusRoute
  /** `/sessions/:sessionId/agents`, optionally focused on one agent tab. */
  data class Session(val id: String, override val agentId: String? = null) : ArgusRoute
  /** `/sessions/:sessionId/git/:gitView`. */
  data class SessionGit(val id: String, val view: GitRoute) : ArgusRoute
  /** `/sessions/:sessionId/code?path=&line=`: the code view, on a file and 1-based line. */
  data class SessionCode(val id: String, val filePath: String? = null, val line: Int? = null) : ArgusRoute
  /** `/compare/:groupId`: a compare run's slots side by side. */
  data class CompareRun(val groupId: String) : ArgusRoute
  /** `/pull-requests`: the PRs of interest across open projects. */
  data object PullRequests : ArgusRoute
  /**
   * `/issues[/<scope>][/<IDENTIFIER>]`, or `/issues/search[/<IDENTIFIER>]?q=` while searching. The
   * scope stays on the route, off the URL, so clearing the search returns to it.
   */
  data class Issues(
    val scope: LinearIssueScope = LinearIssueScope.assigned,
    val issue: String? = null,
    val query: String? = null,
  ) : ArgusRoute
  /** `/design?url=&session=`: a Figma frame in the design viewer, for [session] when it has one. */
  data class Design(val url: String, val session: String? = null) : ArgusRoute
  /** `/pull-requests/:owner/:repo/:number`; [repo] is `owner/repo` (or a nested GitLab path). */
  data class PullRequest(val repo: String, val number: Int) : ArgusRoute
  /** `/pull-requests/:owner/:repo/:number/guide`: the pull request's review guide. */
  data class PullRequestGuide(val repo: String, val number: Int) : ArgusRoute
  /** `/automations`: every automation on this host. */
  data object Automations : ArgusRoute
  /** `/automations/quick`, or one ad-hoc run under it. */
  data class QuickRun(val runId: String? = null) : ArgusRoute
  /** `/automations/describe`: draft an automation from a sentence. */
  data object DescribeAutomation : ArgusRoute
  /** `/automations/:automationId`, or one of its runs. */
  data class Automation(val id: String, val runId: String? = null) : ArgusRoute
  /** `/blueprints`: this computer's recipes for new projects. */
  data object Blueprints : ArgusRoute
  /** `/blueprints/:blueprintId`, or `/blueprints/new` when [id] is null. */
  data class Blueprint(val id: String? = null) : ArgusRoute
  /** `/blueprints/generate`: pick projects to draft a blueprint from. */
  data object GenerateBlueprint : ArgusRoute
  /** `/blueprints/new-project?blueprint=`: a new project from a blueprint. */
  data class NewProject(val blueprintId: String? = null) : ArgusRoute
  /** `/inbox?automation=&project=`: proposals, work waiting for review, failed runs. */
  data class Inbox(val filter: InboxFilter = InboxFilter.all) : ArgusRoute
  /** `/inbox/proposals/:proposalId`. */
  data class Proposal(val id: String) : ArgusRoute
  /** `/notifications`: warnings and errors. */
  data object Notifications : ArgusRoute
  /** `/usage`, `/usage/cost` or `/usage/tokens`, `?range=` on the last two; null is the default 30 days. */
  data class Usage(val tab: UsageTab, val range: UsageRange? = null) : ArgusRoute
  /** `/usage/:tab/models/:runner/:model?range=`: one model's detail under Cost or Tokens. */
  data class UsageModel(val tab: UsageTab, val runner: String, val model: String, val range: UsageRange? = null) :
    ArgusRoute
  /** `/usage/prices`: the model price editor. */
  data object UsagePrices : ArgusRoute
  /** `/usage/models`: which models Usage counts or leaves out. */
  data object UsageModels : ArgusRoute

  /** A pull request's detail screen, and whether it's on its Guide tab. */
  data class PullRequestDetail(val repo: String, val number: Int, val guide: Boolean)

  /** The path this route is at, without `?host=`; [ArgusRoute.parse] reads it back. */
  val path: String get() = routePath(this)

  val sessionId: String?
    get() = when (this) {
      is Session -> id
      is SessionGit -> id
      is SessionCode -> id
      else -> null
    }

  /** The inbox, filtered or not. */
  val isInbox: Boolean get() = this is Inbox

  val isDevices: Boolean get() = this == Devices || this is Device

  /** The agent tab a session route is focused on. */
  val agentId: String? get() = null

  val pullRequestDetail: PullRequestDetail?
    get() = when (this) {
      is PullRequest -> PullRequestDetail(repo, number, guide = false)
      is PullRequestGuide -> PullRequestDetail(repo, number, guide = true)
      else -> null
    }

  /** Any of the blueprint screens. */
  val isBlueprints: Boolean
    get() = this == Blueprints || this is Blueprint || this == GenerateBlueprint || this is NewProject

  val gitView: GitRoute? get() = (this as? SessionGit)?.view

  /** The route pattern, never the ids: what telemetry may see. */
  val pattern: String
    get() = when (this) {
      Home -> "/"
      Agents -> "/agents"
      Runtimes -> "/runtimes"
      Devices -> "/devices"
      is Device -> "/devices/:platform/:deviceKey"
      is Session -> "/sessions/:sessionId/agents"
      is SessionGit -> "/sessions/:sessionId/git/${view.segment}"
      is SessionCode -> "/sessions/:sessionId/code"
      is CompareRun -> "/compare/:groupId"
      PullRequests -> "/pull-requests"
      is PullRequest -> "/pull-requests/:owner/:repo/:number"
      is PullRequestGuide -> "/pull-requests/:owner/:repo/:number/guide"
      is Issues -> issuesBase(scope, query) + if (issue == null) "" else "/:issue"
      is Design -> "/design"
      Automations -> "/automations"
      is QuickRun -> if (runId == null) "/automations/quick" else "/automations/quick/runs/:runId"
      DescribeAutomation -> "/automations/describe"
      is Automation -> if (runId == null) "/automations/:automationId" else "/automations/:automationId/runs/:runId"
      Blueprints -> "/blueprints"
      is Blueprint -> if (id == null) "/blueprints/new" else "/blueprints/:blueprintId"
      GenerateBlueprint -> "/blueprints/generate"
      is NewProject -> "/blueprints/new-project"
      is Inbox -> "/inbox"
      is Proposal -> "/inbox/proposals/:proposalId"
      Notifications -> "/notifications"
      is Usage -> if (tab == UsageTab.Limits) "/usage" else "/usage/${tab.rawValue}"
      is UsageModel -> "/usage/${tab.rawValue}/models/:runner/:model"
      UsagePrices -> "/usage/prices"
      UsageModels -> "/usage/models"
    }

  companion object {
    const val ISSUE_SEARCH_SEGMENT = "search"

    /** `/issues`, `/issues/<scope>` or `/issues/search`, never the term. */
    fun issuesBase(scope: LinearIssueScope, query: String?): String = when {
      query != null -> "/issues/$ISSUE_SEARCH_SEGMENT"
      scope == LinearIssueScope.assigned -> "/issues"
      else -> "/issues/${scope.rawValue}"
    }

    /** The route at [path] (query included, `?host=` ignored); null for one no screen owns. */
    fun parse(path: String): ArgusRoute? = parseRoute(path)

    /** `argus://sessions/abc/agents`: the host part is the path's first segment. */
    fun fromDeepLink(url: String): ArgusRoute? = pathOfDeepLink(url)?.let(::parse)

    /** `argus://sessions/abc/agents?x=1` → `/sessions/abc/agents?x=1`; null for another scheme. */
    fun pathOfDeepLink(url: String): String? = deepLinkPath(url)

    /** A known range other than the default; anything else reads as the default. */
    fun usageRange(raw: String?): UsageRange? =
      UsageRange.entries.firstOrNull { it.rawValue == raw }?.takeIf { it != UsageRange.default }

    /** `?a=1&b=2` from the items that have a value; empty when none do. */
    fun query(vararg items: Pair<String, String?>): String = queryString(items.toList())

    /** One path segment, percent-encoded so `/`, `?`, `#`, `&` and `=` survive. */
    fun encode(segment: String): String = encodeSegment(segment)

    /** The path and its query items; a malformed query reads as none. */
    fun split(raw: String): Pair<String, Map<String, String>> = splitPath(raw)
  }
}

/** A route plus the machine it reads from: `?host=<id>` on any path. Null host is this one. */
class ArgusLocation(val route: ArgusRoute, host: String? = null) {
  val host: String? = host?.takeIf { it != LOCAL_HOST }

  val path: String
    get() {
      val base = route.path
      val host = host ?: return base
      return base + (if ('?' in base) "&" else "?") + "host=" + ArgusRoute.encode(host)
    }

  override fun equals(other: Any?): Boolean = other is ArgusLocation && other.route == route && other.host == host

  override fun hashCode(): Int = 31 * route.hashCode() + (host?.hashCode() ?: 0)

  override fun toString(): String = "ArgusLocation($path)"

  companion object {
    /** The host this app runs beside; never issued as a device id, so it can't collide. */
    const val LOCAL_HOST = "local"

    fun parse(path: String): ArgusLocation? {
      val route = ArgusRoute.parse(path) ?: return null
      return ArgusLocation(route, ArgusRoute.split(path).second["host"]?.takeIf { it.isNotEmpty() })
    }

    fun fromDeepLink(url: String): ArgusLocation? = ArgusRoute.pathOfDeepLink(url)?.let(::parse)
  }
}
