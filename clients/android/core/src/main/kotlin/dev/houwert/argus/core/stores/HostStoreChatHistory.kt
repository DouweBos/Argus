package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemotePermissionMode
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteStoppedAgent

/** A message line that matched a chat search; offsets are UTF-16, as JavaScript counts them (and so does Kotlin). */
typealias ChatHistoryMatch = MethodsTypes.AgentsHistorySearchResultResultsItemMessageMatchesItem

data class MatchParts(val before: String, val hit: String, val after: String)

/** The snippet around its hit, offsets clamped to the text. */
val ChatHistoryMatch.parts: MatchParts
  get() {
    val start = matchStart.toInt().coerceIn(0, snippet.length)
    val end = matchEnd.toInt().coerceIn(start, snippet.length)
    return MatchParts(snippet.substring(0, start), snippet.substring(start, end), snippet.substring(end))
  }

// A project's saved chats: listed per session, searched, deleted and resumed.
// Live agents are never here; the host leaves them to `agents.list`.

/** A session's past chats, newest first; null when the host couldn't be asked. */
suspend fun HostStore.chatHistory(session: RemoteSession): List<RemoteStoppedAgent>? {
  if (backend == null) return null
  loadStoppedAgents(session.repoRoot)
  return chats(session)
}

/** What [chatHistory] last found, without asking again. */
fun HostStore.chats(session: RemoteSession): List<RemoteStoppedAgent>? =
  _stoppedByRepo.value[session.repoRoot]?.filter { it.branch == session.branch }?.sortedByDescending { it.endedAt }

fun HostStore.stoppedChat(repoRoot: String, historyId: String): RemoteStoppedAgent? =
  _stoppedByRepo.value[repoRoot]?.firstOrNull { it.historyId == historyId }

/** Message hits across the repo's saved chats, by history id; titles are the caller's to match. */
suspend fun HostStore.searchChatHistory(repoRoot: String, query: String): Map<String, List<ChatHistoryMatch>>? {
  val q = query.trim()
  val backend = backend ?: return null
  if (q.isEmpty()) return null
  val result = runCatching { backend.request(Methods.AgentsHistorySearch, MethodsTypes.AgentsHistorySearchParams(repoRoot, q)) }.getOrNull() ?: return null
  return result.results.distinctBy { it.historyId }.associate { it.historyId to it.messageMatches }
}

/** The search's hits for one query. */
data class ChatHits(val query: String, val matches: Map<String, List<ChatHistoryMatch>>)

/** The chats a search shows: titles narrow at once, the host's hits once they arrive. */
fun HostStore.Companion.filterChats(chats: List<RemoteStoppedAgent>, query: String, hits: ChatHits?): List<RemoteStoppedAgent> {
  val needle = query.trim()
  if (needle.isEmpty()) return chats
  if (hits == null || hits.query != needle) return chats.filter { it.title.contains(needle, ignoreCase = true) }
  return chats.filter { it.historyId in hits.matches }
}

/** Delete saved chats, then re-read the list so every screen follows. */
suspend fun HostStore.deleteChatHistory(repoRoot: String, historyIds: List<String>) {
  val backend = backend ?: return
  for (id in historyIds) {
    try {
      backend.request(Methods.AgentsHistoryDelete, MethodsTypes.AgentsHistoryDeleteParams(repoRoot, id))
    } catch (e: Exception) {
      report(e)
      break
    }
  }
  loadStoppedAgents(repoRoot)
}

/** A new agent on the chat's conversation, runner, model, mode and effort; the host seeds its transcript. */
suspend fun HostStore.resumeChat(chat: RemoteStoppedAgent, sessionId: String): RemoteAgentStatus? =
  resume(sessionId, chat.runnerSessionId, chat.runnerId, chat.model, chat.permissionMode, chat.effort)

data class OpenedAgent(val agentId: String, val spawned: Boolean)

/** The agent a link names: itself while live, else its saved chat resumed in a new agent. */
suspend fun HostStore.openAgent(agentId: String, session: RemoteSession): OpenedAgent? {
  loadAgents(session.repoRoot)
  val live = _agentsByRepo.value[session.repoRoot].orEmpty().filter { it.sessionId == session.id }.map { it.agentId }.toSet()
  if (agentId in live) return OpenedAgent(agentId, false)
  resumedAs[agentId]?.takeIf { it in live }?.let { return OpenedAgent(it, false) }
  // The host lists only chats whose agent is gone.
  loadStoppedAgents(session.repoRoot)
  val chat = _stoppedByRepo.value[session.repoRoot]?.firstOrNull { it.agentId == agentId } ?: return null
  val agent = resumeChat(chat, session.id) ?: return null
  resumedAs[agentId] = agent.agentId
  return OpenedAgent(agent.agentId, true)
}

/** A stopped agent picks up again only once its runner reported a session to resume. */
fun HostStore.canResume(agentId: String) = _statusByAgent.value[agentId]?.runnerSessionId != null

/** A new agent in the same session, on the stopped one's conversation and settings. */
suspend fun HostStore.resumeAgent(agentId: String): RemoteAgentStatus? {
  val status = _statusByAgent.value[agentId] ?: return null
  val ref = status.runnerSessionId ?: return null
  val resumed = resume(status.sessionId, ref, status.runnerId, status.model, status.permissionMode, status.effort ?: _effortByAgent.value[agentId])
  resumed?.let { notePinMoved(agentId, it) }
  return resumed
}

/** A mode the gateway can't spawn (`trusted`) falls back to the host's default. */
private suspend fun HostStore.resume(sessionId: String, ref: String, runnerId: String?, model: String?, mode: String?, effort: String?): RemoteAgentStatus? {
  val gatewayMode = mode?.let { RemotePermissionMode(it) }?.takeIf { it in RemotePermissionMode.entries }
  val agent = spawnAgent(sessionId, model, gatewayMode, resumeSessionId = ref, runnerId = runnerId) ?: return null
  effort?.let { applyEffort(agent.agentId, it) }
  return agent
}
