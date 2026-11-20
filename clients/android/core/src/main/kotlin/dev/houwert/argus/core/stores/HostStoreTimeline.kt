package dev.houwert.argus.core.stores

import dev.houwert.argus.core.git.SessionTimeline
import dev.houwert.argus.core.git.TimelineRestore
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes

// A session's version timeline: its agent turns, restoring the files to where one ended, and undoing that.

suspend fun HostStore.loadTimeline(sessionId: String): SessionTimeline {
  val backend = backend ?: return SessionTimeline()
  return SessionTimeline.of(backend.request(Methods.SessionsTimeline, MethodsTypes.SessionsTimelineParams(sessionId)))
}

/** Files only: the conversation stays as it is. The host refuses while an agent in the session works. */
suspend fun HostStore.restoreTurn(sessionId: String, checkpointId: String): TimelineRestore? {
  val backend = backend ?: return null
  return TimelineRestore.of(backend.request(Methods.SessionsRestoreTurn, MethodsTypes.SessionsRestoreTurnParams(sessionId, checkpointId)).restore)
}

suspend fun HostStore.undoRestore(sessionId: String, restoreId: String) {
  val backend = backend ?: return
  backend.request(Methods.SessionsUndoRestore, MethodsTypes.SessionsUndoRestoreParams(sessionId, restoreId))
}

/** The timeline was opened; restores are counted by the host, which does them. */
fun HostStore.trackTimelineOpened(turns: Int) = hooks.track(StoreEvent.TimelineOpened(turns))
