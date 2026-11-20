package dev.houwert.argus.kit.widgets

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * What the home-screen widgets show, one entry per paired computer. The app writes the
 * computer it is connected to; the others keep their last known state, so a glance covers
 * every computer even though only one is connected at a time. Times are epoch millis.
 */
@Serializable
data class WidgetSnapshot(val hosts: List<Host> = emptyList()) {
  @Serializable
  data class Host(
    val id: String,
    val name: String,
    val updatedAt: Long,
    /** Agents waiting on you, then the ones still running, most recent first. */
    val agents: List<Agent>,
    val proposals: List<Proposal>,
    /** Every proposal waiting, including the ones past [proposals]' cut. */
    val proposalCount: Int,
    val usage: List<UsageAccount>,
  )

  @Serializable
  data class Agent(
    val id: String,
    val title: String,
    val project: String? = null,
    /** Null while it is just running; "needs approval", "answer needed", "review plan". */
    val attention: String? = null,
    val activityAt: Long? = null,
    /** `argus:` link to its chat on its own computer. */
    val url: String,
  ) {
    val needsYou: Boolean get() = attention != null
  }

  @Serializable
  data class Proposal(val id: String, val title: String, val url: String)

  @Serializable
  data class UsageAccount(val label: String, val session: UsageWindow? = null, val weekly: UsageWindow? = null)

  /** [usedPercent] is 0 to 100. */
  @Serializable
  data class UsageWindow(val usedPercent: Double, val resetsAt: Long? = null)

  data class HostAgent(val host: Host, val agent: Agent)

  /** Agents across every computer, waiting ones first. */
  val agents: List<HostAgent>
    get() = hosts.flatMap { host -> host.agents.map { HostAgent(host, it) } }
      .sortedWith(compareByDescending<HostAgent> { it.agent.needsYou }.thenByDescending { it.agent.activityAt ?: Long.MIN_VALUE })

  val needsYouCount: Int get() = hosts.sumOf { host -> host.agents.count { it.needsYou } }
  val runningCount: Int get() = hosts.sumOf { host -> host.agents.count { !it.needsYou } }
  val proposalCount: Int get() = hosts.sumOf { it.proposalCount }

  val proposals: List<Pair<Host, Proposal>> get() = hosts.flatMap { host -> host.proposals.map { host to it } }

  /** Plan usage per Claude account; one signed in on two computers reads once, from whichever wrote last. */
  val usage: List<UsageAccount>
    get() = hosts.sortedByDescending { it.updatedAt }.flatMap { it.usage }.distinctBy { it.label }

  /** The oldest write shown, for an "updated" line. */
  val updatedAt: Long? get() = hosts.minOfOrNull { it.updatedAt }

  val isEmpty: Boolean get() = hosts.isEmpty()

  /** Replaces one computer's entry and drops computers no longer paired. */
  fun upsert(host: Host, paired: Set<String>): WidgetSnapshot =
    copy(hosts = (hosts.filter { it.id != host.id && it.id in paired } + host).sortedBy { it.name.lowercase() })

  fun prune(paired: Set<String>): WidgetSnapshot = copy(hosts = hosts.filter { it.id in paired })

  /** A push arrived while the app may not be running; it carries no computer, so the agent is found by id. */
  fun apply(pushKind: String, agentId: String?, now: Long = System.currentTimeMillis()): WidgetSnapshot {
    agentId ?: return this
    return copy(
      hosts = hosts.map { host ->
        if (host.agents.none { it.id == agentId }) return@map host
        when (pushKind) {
          "permission" -> host.copy(agents = host.agents.map { if (it.id == agentId) it.copy(attention = "needs approval", activityAt = now) else it })
          "finished", "failed" -> host.copy(agents = host.agents.filter { it.id != agentId })
          else -> host
        }
      },
    )
  }

  companion object {
    private val json = Json { ignoreUnknownKeys = true }

    fun decode(text: String?): WidgetSnapshot =
      text?.let { runCatching { json.decodeFromString(serializer(), it) }.getOrNull() } ?: WidgetSnapshot()

    fun encode(snapshot: WidgetSnapshot): String = json.encodeToString(serializer(), snapshot)
  }
}

/** `argus:` links the widgets open, tagged so the app can tell them from other links when it counts them. */
object WidgetLink {
  const val SOURCE_ITEM = "src"

  enum class Source(val wire: String) { Widget("widget"), Control("control"), LiveActivity("live_activity") }

  /** The phone's new-agent composer, on the last active project. */
  const val NEW_AGENT_PATH = "/sessions/new"

  /** `argus:/` + an `ArgusLocation` path, tagged with where it was opened from. */
  fun url(path: String, source: Source = Source.Widget): String =
    "argus:/$path" + (if ('?' in path) "&" else "?") + "$SOURCE_ITEM=${source.wire}"

  fun source(url: String): Source? {
    val query = url.substringAfter('?', "").substringBefore('#')
    val value = query.split('&').firstOrNull { it.startsWith("$SOURCE_ITEM=") }?.substringAfter('=') ?: return null
    return Source.entries.firstOrNull { it.wire == value }
  }

  /** The new-agent composer, which only the phone has. */
  fun isNewAgent(url: String): Boolean {
    val path = url.removePrefix("argus:").removePrefix("//").removePrefix("/").substringBefore('?')
    return path == "sessions/new"
  }
}
