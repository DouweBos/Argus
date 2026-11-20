package dev.houwert.argus.core.stores

import dev.houwert.argus.core.sessions.SessionStack
import dev.houwert.argus.kit.protocol.generated.LandStackResult
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RestackResult
import kotlinx.coroutines.flow.update

// Stacked sessions: restack after a parent changes, land bottom-up.
// The computer counts both itself, so nothing is tracked here.

/** Rebase every session in [sessionId]'s stack onto its parent's tip. */
suspend fun HostStore.restack(sessionId: String): RestackResult? {
  val backend = backend ?: return null
  return try {
    val result = backend.request(Methods.SessionsRestack, MethodsTypes.SessionsRestackParams(sessionId))
    reloadStack(sessionId)
    result
  } catch (e: Exception) {
    report(e, "session:restack")
    null
  }
}

/** Merge the stack from its bottom up; stops at the first thing that needs a person. */
suspend fun HostStore.landStack(sessionId: String, strategy: MergeStrategy): LandStackResult? {
  val backend = backend ?: return null
  return try {
    val result = backend.request(
      Methods.SessionsLandStack,
      MethodsTypes.SessionsLandStackParams(sessionId, MethodsTypes.SessionsLandStackParamsStrategy(strategy.wire)),
    )
    _mergedSessionIds.update { it + result.landed }
    reloadStack(sessionId)
    result
  } catch (e: Exception) {
    report(e, "session:land_stack")
    null
  }
}

private suspend fun HostStore.reloadStack(sessionId: String) {
  val repoRoot = repoRoot(sessionId) ?: return
  loadSessions(repoRoot)
  for (session in SessionStack.members(sessionId, sessionsByRepo.value[repoRoot].orEmpty())) loadGitStatus(session.id)
}
