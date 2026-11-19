package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.generated.GitStashEntry
import dev.houwert.argus.kit.protocol.generated.GitTag
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes

// A session's stashes and tags. Reading is monitor; applying or dropping a stash needs control.

suspend fun HostStore.listStashes(sessionId: String): List<GitStashEntry> {
  val backend = backend ?: return emptyList()
  return try {
    backend.request(Methods.SessionsStashes, MethodsTypes.SessionsStashesParams(sessionId)).stashes
  } catch (e: Exception) {
    report(e, "git:stashes")
    emptyList()
  }
}

/** Git's output, or null when it refused (a conflict keeps the stash). */
suspend fun HostStore.applyStash(sessionId: String, index: Int, drop: Boolean): String? {
  val backend = backend ?: return null
  return try {
    val output = backend.request(Methods.SessionsStashApply, MethodsTypes.SessionsStashApplyParams(sessionId, index.toLong(), drop)).output
    hooks.track(StoreEvent.BranchActed(if (drop) StoreEvent.BranchAction.StashPop else StoreEvent.BranchAction.StashApply))
    output
  } catch (e: Exception) {
    report(e, "git:stash")
    null
  }
}

suspend fun HostStore.dropStash(sessionId: String, index: Int): Boolean {
  val backend = backend ?: return false
  return try {
    backend.request(Methods.SessionsStashDrop, MethodsTypes.SessionsStashDropParams(sessionId, index.toLong()))
    hooks.track(StoreEvent.BranchActed(StoreEvent.BranchAction.StashDrop))
    true
  } catch (e: Exception) {
    report(e, "git:stash")
    false
  }
}

suspend fun HostStore.listTags(sessionId: String): List<GitTag> {
  val backend = backend ?: return emptyList()
  return try {
    backend.request(Methods.SessionsTags, MethodsTypes.SessionsTagsParams(sessionId)).tags
  } catch (e: Exception) {
    report(e, "git:tags")
    emptyList()
  }
}
