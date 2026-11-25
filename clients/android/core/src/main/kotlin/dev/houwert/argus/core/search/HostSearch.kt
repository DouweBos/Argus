package dev.houwert.argus.core.search

import dev.houwert.argus.core.routing.ArgusRoute
import dev.houwert.argus.core.sessions.SessionActivity
import dev.houwert.argus.core.sessions.isArchived
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.recentAgentsByActivity
import dev.houwert.argus.core.stores.repoRoot
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.Teammate
import dev.houwert.argus.kit.util.Labels

/** One thing search can open: an agent, a session or a teammate. */
data class HostSearchResult(
  val kind: Kind,
  val itemId: String,
  val title: String,
  val subtitle: String?,
  /** Extra words it matches on: a session's branch, a teammate's handle. */
  val keywords: List<String>,
  val sessionId: String?,
  val repoRoot: String?,
  val route: ArgusRoute,
) {
  enum class Kind(val wire: String, val title: String) { Agent("agent", "Agents"), Session("session", "Sessions"), Teammate("teammate", "Teammates") }

  val id: String get() = "${kind.wire}:$itemId"
}

/** Search across what the computer has running, matched as the Mac's command palette matches. */
object HostSearch {
  fun agent(agent: RemoteAgentStatus, repoRoot: String?) = HostSearchResult(
    HostSearchResult.Kind.Agent, agent.agentId, Labels.agentName(agent),
    listOfNotNull(agent.projectName, agent.sessionLabel).filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { null },
    listOfNotNull(agent.sessionLabel, agent.projectName), agent.sessionId, repoRoot,
    ArgusRoute.Session(agent.sessionId, agent.agentId),
  )

  fun session(session: RemoteSession, place: String) = HostSearchResult(
    HostSearchResult.Kind.Session, session.id, SessionActivity.title(session),
    listOfNotNull(place, SessionActivity.subtitle(session)).joinToString(" · "),
    listOf(session.branch, place), session.id, session.repoRoot, ArgusRoute.Session(session.id, null),
  )

  fun teammate(teammate: Teammate) = HostSearchResult(
    HostSearchResult.Kind.Teammate, teammate.id, teammate.name,
    "@${teammate.handle}" + if (teammate.tagline.isEmpty()) "" else " · ${teammate.tagline}",
    listOf(teammate.handle, teammate.tagline), null, null, ArgusRoute.Teammate(teammate.id),
  )

  /** Everything the store holds, archived sessions left out as the lists leave them out. */
  fun items(host: HostStore, teammates: List<Teammate>): List<HostSearchResult> {
    val agents = host.recentAgentsByActivity.map { agent(it, host.repoRoot(ofAgent = it)) }
    val sessions = (host.sessionsByRepo.value.values.flatten() + host.scratchPads.value)
      .filter { !it.isArchived }
      .map { session(it, host.placeName(it)) }
    return agents + sessions + teammates.map(::teammate)
  }

  /** Ranked best first; an empty query matches nothing, so the screen can show its hint. */
  fun results(query: String, items: List<HostSearchResult>, limit: Int = 50): List<HostSearchResult> {
    if (query.isBlank()) return emptyList()
    return PaletteMatch.rank(items.distinctBy { it.id }, query) { listOf(it.title) + it.keywords + listOfNotNull(it.subtitle) }.take(limit)
  }

  /** Results in a section per kind, the best-matching kind first. */
  fun grouped(results: List<HostSearchResult>): List<Pair<HostSearchResult.Kind, List<HostSearchResult>>> =
    results.groupBy { it.kind }.toList()
}
