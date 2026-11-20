package dev.houwert.argus.core.files

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.kit.protocol.generated.CodeSearchEvent
import dev.houwert.argus.kit.protocol.generated.CodeSearchMatch
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class FileSearchQuery(
  val text: String,
  val regex: Boolean = false,
  val caseSensitive: Boolean = false,
  val wholeWord: Boolean = false,
  val maxResults: Int? = null,
)

/** How a search reaches the host: the phone goes through the gateway's `files.search`. */
interface FileSearchTransport {
  /** Start a search whose events go to [deliver] until it is done or [endFileSearch]. */
  suspend fun startFileSearch(sessionId: String, searchId: String, query: FileSearchQuery, deliver: (CodeSearchEvent) -> Unit)
  /** Ask the host to stop a running search, then stop listening for it. */
  suspend fun cancelFileSearch(sessionId: String, searchId: String)
  /** Drop the listener; the search itself is left alone. */
  fun endFileSearch(searchId: String)
}

/**
 * One worktree search at a time for one session: starting a new query cancels the last, and
 * matches stream in grouped by file in the order the host found them.
 */
class FileSearchStore(
  private val transport: FileSearchTransport,
  private val sessionId: String,
  private val scope: CoroutineScope,
) {
  data class Group(val path: String, val matches: List<CodeSearchMatch>) {
    val id get() = path
  }

  sealed interface Phase {
    data object Idle : Phase
    data object Running : Phase
    data class Done(val count: Int, val truncated: Boolean) : Phase
    data class Failed(val message: String) : Phase
  }

  private val _groups = MutableStateFlow(emptyList<Group>())
  val groups: StateFlow<List<Group>> = _groups.asStateFlow()
  private val _phase = MutableStateFlow<Phase>(Phase.Idle)
  val phase: StateFlow<Phase> = _phase.asStateFlow()
  private val _matchCount = MutableStateFlow(0)
  val matchCount: StateFlow<Int> = _matchCount.asStateFlow()

  /** Called once per search that finished on its own (not cancelled). */
  var onFinished: ((FileSearchQuery, Int, Boolean) -> Unit)? = null
  /** How long [schedule] waits for typing to settle, in milliseconds. */
  var debounce = 350L

  private var searchId: String? = null
  private var query: FileSearchQuery? = null
  private val groupIndex = mutableMapOf<String, Int>()
  private var pending: Job? = null
  /** The results came from [show], not a search for [query]. */
  private var shownExternally = false

  constructor(host: HostStore, sessionId: String) : this(dev.houwert.argus.core.stores.HostFileSearch(host), sessionId, host.scope)

  /** Run [query] once typing settles; a newer call replaces a waiting one. */
  fun schedule(query: FileSearchQuery) {
    pending?.cancel()
    // [show] put the query's text in the field; don't replace its results with a search.
    if (shownExternally && query.text == this.query?.text) return
    pending = scope.launch {
      delay(debounce)
      run(query)
    }
  }

  /** Cancel whatever is running and start [query]; an empty query just clears. */
  suspend fun run(query: FileSearchQuery) {
    detach()?.let { transport.cancelFileSearch(sessionId, it) }
    reset()
    if (query.text.isEmpty()) return
    val id = UUID.randomUUID().toString()
    val sent = query.copy(maxResults = query.maxResults ?: MAX_RESULTS)
    searchId = id
    this.query = sent
    _phase.value = Phase.Running
    try {
      transport.startFileSearch(sessionId, id, sent) { receive(it, id) }
    } catch (error: Throwable) {
      if (HostStore.isCancellation(error)) throw error
      if (searchId != id) return
      searchId = null
      _phase.value = Phase.Failed(HostStore.describe(error))
    }
  }

  /** Matches found elsewhere, shown as if searched for [title]. */
  fun show(matches: List<CodeSearchMatch>, title: String) {
    pending?.cancel()
    detach()?.let { id -> scope.launch { transport.cancelFileSearch(sessionId, id) } }
    reset()
    query = FileSearchQuery(title)
    shownExternally = true
    append(matches)
    _phase.value = Phase.Done(matches.size, false)
  }

  /** Stop the running search, if any, keeping what has arrived. */
  suspend fun cancel() {
    pending?.cancel()
    val id = detach() ?: return
    transport.cancelFileSearch(sessionId, id)
  }

  fun reset() {
    _groups.value = emptyList()
    groupIndex.clear()
    _matchCount.value = 0
    _phase.value = Phase.Idle
    query = null
    shownExternally = false
  }

  private fun detach(): String? {
    val id = searchId ?: return null
    searchId = null
    if (_phase.value == Phase.Running) _phase.value = Phase.Done(_matchCount.value, false)
    return id
  }

  internal fun receive(event: CodeSearchEvent, id: String) {
    if (id != searchId) return
    when (event) {
      is CodeSearchEvent.Matches -> append(event.value.matches)
      is CodeSearchEvent.Done -> {
        searchId = null
        transport.endFileSearch(id)
        val done = event.value
        val error = done.error
        if (error != null) {
          _phase.value = Phase.Failed(error)
        } else {
          _phase.value = Phase.Done(maxOf(done.count.toInt(), _matchCount.value), done.truncated)
          val query = query
          if (!done.cancelled && query != null) onFinished?.invoke(query, _matchCount.value, done.truncated)
        }
      }
      is CodeSearchEvent.Unknown -> {}
    }
  }

  internal fun append(matches: List<CodeSearchMatch>) {
    val groups = _groups.value.toMutableList()
    for (match in matches) {
      val index = groupIndex[match.relativePath]
      if (index != null) {
        groups[index] = groups[index].copy(matches = groups[index].matches + match)
      } else {
        groupIndex[match.relativePath] = groups.size
        groups += Group(match.relativePath, listOf(match))
      }
    }
    _groups.value = groups
    _matchCount.value += matches.size
  }

  companion object {
    /** Matches past this stop the search; a list has no use for more. */
    const val MAX_RESULTS = 2000
  }
}
