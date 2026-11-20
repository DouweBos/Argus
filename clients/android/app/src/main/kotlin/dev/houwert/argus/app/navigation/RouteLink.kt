package dev.houwert.argus.app.navigation

import dev.houwert.argus.core.routing.ArgusRoute
import dev.houwert.argus.core.routing.GitRoute
import dev.houwert.argus.core.sessions.SessionActivity
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.adoptSession
import dev.houwert.argus.core.stores.loadSessions
import dev.houwert.argus.core.stores.refreshProjects
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.isOutsideProjects
import dev.houwert.argus.kit.util.Labels
import kotlinx.coroutines.delay

/** Where a route the Mac and the phone share lands on the phone; [isFallback] when it has no such screen. */
data class PhoneDestination(val section: AppSection, val route: Route? = null, val isFallback: Boolean = false)

/** What the sender already knows, so a title doesn't wait on a lookup. */
data class RouteHints(val agentLabel: String? = null, val repoRoot: String? = null, val projectName: String? = null)

object RouteLink {
  /** The phone screen for an `argus://` link, a shortcut or a widget: a session lands on its screen, an agent on its tab. */
  suspend fun resolve(route: ArgusRoute, host: HostStore, hints: RouteHints = RouteHints()): PhoneDestination = when (route) {
    ArgusRoute.Home -> PhoneDestination(AppSection.Home)
    ArgusRoute.Runtimes -> PhoneDestination(AppSection.Home, isFallback = true)
    ArgusRoute.Agents -> PhoneDestination(AppSection.Agents)
    ArgusRoute.Devices -> PhoneDestination(AppSection.Devices)
    is ArgusRoute.Device -> PhoneDestination(AppSection.Devices, isFallback = true)
    is ArgusRoute.Inbox -> PhoneDestination(AppSection.Inbox)
    is ArgusRoute.Proposal -> PhoneDestination(AppSection.Inbox, Route.Proposal(route.id))
    ArgusRoute.PullRequests -> PhoneDestination(AppSection.PullRequests)
    is ArgusRoute.PullRequest -> PhoneDestination(AppSection.PullRequests, Route.PullRequest(route.repo, route.number, "#${route.number}"))
    is ArgusRoute.PullRequestGuide ->
      PhoneDestination(AppSection.PullRequests, Route.PullRequest(route.repo, route.number, "#${route.number}"), isFallback = true)
    is ArgusRoute.Issues -> PhoneDestination(AppSection.Issues, route.issue?.let { Route.Issue(it) })
    is ArgusRoute.Design -> PhoneDestination(AppSection.Home, Route.Design(route.url, route.session))
    ArgusRoute.Automations -> PhoneDestination(AppSection.Automations)
    ArgusRoute.DescribeAutomation -> PhoneDestination(AppSection.Automations, Route.DescribeAutomation)
    is ArgusRoute.QuickRun ->
      PhoneDestination(AppSection.Automations, route.runId?.let { Route.Run(it, "Run") } ?: Route.QuickRun)
    is ArgusRoute.Automation ->
      PhoneDestination(AppSection.Automations, route.runId?.let { Route.Run(it, "Run") } ?: Route.Automation(route.id, "Automation"))
    ArgusRoute.Blueprints -> PhoneDestination(AppSection.Blueprints)
    is ArgusRoute.Blueprint -> PhoneDestination(AppSection.Blueprints, Route.Blueprint(route.id))
    ArgusRoute.GenerateBlueprint -> PhoneDestination(AppSection.Blueprints, Route.GenerateBlueprint)
    is ArgusRoute.NewProject -> PhoneDestination(AppSection.Blueprints, Route.NewProject(route.blueprintId))
    ArgusRoute.Notifications -> PhoneDestination(AppSection.Notifications)
    is ArgusRoute.Usage -> PhoneDestination(AppSection.Usage)
    is ArgusRoute.UsageModel -> PhoneDestination(AppSection.Usage, isFallback = true)
    ArgusRoute.UsagePrices -> PhoneDestination(AppSection.Usage, Route.UsagePrices)
    ArgusRoute.UsageModels -> PhoneDestination(AppSection.Usage, Route.UsageModels)
    is ArgusRoute.CompareRun -> PhoneDestination(AppSection.Home, Route.CompareRun(route.groupId))
    is ArgusRoute.Session -> {
      val agentId = route.agentId
      if (agentId != null) {
        val label = host.statusByAgent.value[agentId]?.let(Labels::agentName) ?: hints.agentLabel ?: "Agent"
        PhoneDestination(AppSection.Home, Route.Agent(agentId, label))
      } else {
        session(route.id, host)?.let { PhoneDestination(AppSection.Home, Route.Session(it.id, SessionActivity.title(it), it.repoRoot)) }
          ?: sessionHome(route.id, host, hints)
      }
    }
    is ArgusRoute.SessionGit ->
      session(route.id, host)?.let { PhoneDestination(AppSection.Home, gitScreen(route.view, it)) } ?: sessionHome(route.id, host, hints)
    is ArgusRoute.SessionCode ->
      session(route.id, host)?.let { PhoneDestination(AppSection.Home, Route.QuickOpen(it.id, SessionActivity.title(it)), isFallback = route.filePath != null) }
        ?: sessionHome(route.id, host, hints)
  }

  /** A git sub-view the phone has, or the working copy beneath every one it doesn't. */
  private fun gitScreen(view: GitRoute, session: RemoteSession): Route {
    val label = SessionActivity.title(session)
    return when (view) {
      GitRoute.Stashes, is GitRoute.Tags -> Route.Stashes(session.id, label)
      GitRoute.History, is GitRoute.Branches -> Route.Branches(session.id, session.repoRoot, label)
      is GitRoute.Compare ->
        if (view.left.isNotEmpty() && view.right.isNotEmpty()) Route.BranchCompare(session.id, view.left, view.right) else Route.Changes(session.id, label)
      is GitRoute.Timeline -> view.turn?.let { Route.TurnChanges(session.id, label, it) } ?: Route.Timeline(session.id, label)
      else -> Route.Changes(session.id, label)
    }
  }

  /** A session the phone can't find: its project, or Home when it has none. */
  private suspend fun sessionHome(id: String, host: HostStore, hints: RouteHints): PhoneDestination {
    val repoRoot = session(id, host)?.takeUnless { it.isOutsideProjects }?.repoRoot ?: hints.repoRoot
      ?: return PhoneDestination(AppSection.Home, isFallback = true)
    val name = host.projects.value.firstOrNull { it.repoRoot == repoRoot }?.name ?: hints.projectName ?: repoRoot.substringAfterLast('/')
    return PhoneDestination(AppSection.Home, Route.Project(repoRoot, name))
  }

  /** A held session, or one fetched by id when no list the phone has carries it. */
  private suspend fun session(id: String, host: HostStore): RemoteSession? {
    host.session(id)?.let { return it }
    settle(host)
    // Sessions load per project as their screens open; a link can arrive first.
    for (project in host.projects.value) {
      if (host.sessionsByRepo.value[project.repoRoot] != null) continue
      host.loadSessions(project.repoRoot)
      host.session(id)?.let { return it }
    }
    host.adoptSession(id)
    return host.session(id)
  }

  /** A link opened at launch lands before the computer has answered; give the first project list a bounded wait. */
  suspend fun settle(host: HostStore, timeoutMillis: Long = 8_000) {
    val deadline = System.currentTimeMillis() + timeoutMillis
    var asked = false
    while (!host.projectsLoaded.value && System.currentTimeMillis() < deadline) {
      if (host.connection.value == Transport.State.Ready && !asked) {
        asked = true
        host.refreshProjects()
        continue
      }
      // A reconnect drops the first answer; ask again once it's back.
      if (host.connection.value != Transport.State.Ready) asked = false
      delay(150)
    }
  }
}

/** Land on a resolved destination: its screen, or its section's root. */
fun Router.open(destination: PhoneDestination) {
  val route = destination.route
  if (route != null) open(route, destination.section) else show(destination.section)
}
