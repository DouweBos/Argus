package dev.houwert.argus.core.stores

import dev.houwert.argus.core.files.FileSearchQuery
import dev.houwert.argus.core.files.FileSearchTransport
import dev.houwert.argus.kit.protocol.EventEnvelope
import dev.houwert.argus.kit.protocol.generated.CodeFile
import dev.houwert.argus.kit.protocol.generated.CodeFileRange
import dev.houwert.argus.kit.protocol.generated.CodeSearchEvent
import dev.houwert.argus.kit.protocol.generated.Events
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import kotlinx.coroutines.launch

// Read-only file access for a session: one file's contents, and a streamed worktree search. Both are control-tier.

/** Throws so the viewer can tell "not in this session" from a dropped link. */
suspend fun HostStore.readFile(sessionId: String, path: String): CodeFile {
  val backend = backend ?: throw HostStore.offlineError
  return backend.request(Methods.FilesRead, MethodsTypes.FilesReadParams(sessionId, path))
}

/** A PDF's or an image's bytes; the host refuses past 8 MB. */
suspend fun HostStore.readFileBytes(sessionId: String, path: String): ByteArray {
  val backend = backend ?: throw HostStore.offlineError
  val result = backend.request(Methods.FilesReadBytes, MethodsTypes.FilesReadBytesParams(sessionId, path))
  return java.util.Base64.getDecoder().decode(result.data)
}

/** A page of a file too large for [readFile]. */
suspend fun HostStore.readFileRange(sessionId: String, path: String, offset: Long, length: Long): CodeFileRange {
  val backend = backend ?: throw HostStore.offlineError
  return backend.request(Methods.FilesReadRange, MethodsTypes.FilesReadRangeParams(sessionId, path, offset, length))
}

/** The gateway's `files.search`, with `files.search` events routed to each search's listener. */
class HostFileSearch(private val host: HostStore) : FileSearchTransport {
  private val observers = mutableMapOf<String, (CodeSearchEvent) -> Unit>()
  private var stopObserving: (() -> Unit)? = null

  override suspend fun startFileSearch(sessionId: String, searchId: String, query: FileSearchQuery, deliver: (CodeSearchEvent) -> Unit) {
    val backend = host.backend ?: throw HostStore.offlineError
    // Listen before the call, so no early batch is lost.
    observers[searchId] = deliver
    if (stopObserving == null) stopObserving = host.observeEvents(::route)
    backend.subscribe(searchScope(searchId), true)
    try {
      backend.request(
        Methods.FilesSearch,
        MethodsTypes.FilesSearchParams(
          sessionId = sessionId, searchId = searchId, query = query.text, regex = query.regex,
          caseSensitive = query.caseSensitive, wholeWord = query.wholeWord, maxResults = query.maxResults?.toLong(),
        ),
      )
    } catch (error: Throwable) {
      endFileSearch(searchId)
      throw error
    }
  }

  override suspend fun cancelFileSearch(sessionId: String, searchId: String) {
    endFileSearch(searchId)
    val backend = host.backend ?: return
    runCatching { backend.request(Methods.FilesSearchCancel, MethodsTypes.FilesSearchCancelParams(sessionId, searchId)) }
  }

  override fun endFileSearch(searchId: String) {
    observers.remove(searchId) ?: return
    if (observers.isEmpty()) {
      stopObserving?.invoke()
      stopObserving = null
    }
    val backend = host.backend ?: return
    host.scope.launch { runCatching { backend.subscribe(searchScope(searchId), false) } }
  }

  private fun route(envelope: EventEnvelope) {
    if (envelope.event != Events.FilesSearch.name) return
    val event = envelope.decode(Events.FilesSearch) ?: return
    val id = when (event) {
      is CodeSearchEvent.Matches -> event.value.searchId
      is CodeSearchEvent.Done -> event.value.searchId
      is CodeSearchEvent.Unknown -> return
    }
    observers[id]?.invoke(event)
  }

  companion object {
    fun searchScope(searchId: String) = "code-search:$searchId"
  }
}
