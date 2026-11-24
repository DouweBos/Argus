package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.OpenedTeammateThread
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationMemory
import dev.houwert.argus.kit.protocol.generated.Teammate
import kotlinx.coroutines.flow.update

// The gallery, conversations and memory: what a teammate's pages reach beyond its identity.

suspend fun TeammatesStore.loadTemplates() {
  val backend = host.backend ?: return
  try {
    _templates.value = backend.request(Methods.TeammatesTemplates, MethodsTypes.TeammatesTemplatesParams()).templates
  } catch (e: Exception) {
    fail("Couldn't read the starting teammates", e)
  }
}

/** A teammate and its duties from a template, scoped to [repoRoots]. */
suspend fun TeammatesStore.createFromTemplate(templateId: String, repoRoots: List<String>): Teammate? {
  val backend = host.backend ?: return null
  return try {
    val teammate = backend.request(
      Methods.TeammatesCreateFromTemplate, MethodsTypes.TeammatesCreateFromTemplateParams(templateId, repoRoots),
    ).teammate
    _error.value = null
    refresh()
    teammate
  } catch (e: Exception) {
    fail("Couldn't create that teammate", e)
    null
  }
}

suspend fun TeammatesStore.loadThreads(teammateId: String) {
  val backend = host.backend ?: return
  runCatching { backend.request(Methods.TeammatesThreads, MethodsTypes.TeammatesThreadsParams(teammateId)).threads }
    .onSuccess { threads -> _threadsById.update { it + (teammateId to threads.sortedByDescending { t -> t.lastOpenedAt }) } }
}

/**
 * The conversation's live agent, woken if it was asleep: [threadId] null opens the newest direct
 * one, [fresh] starts a new one.
 */
suspend fun TeammatesStore.openThread(teammateId: String, threadId: String? = null, fresh: Boolean = false): OpenedTeammateThread? {
  val backend = host.backend ?: return null
  return try {
    val opened = backend.request(
      Methods.TeammatesOpenThread, MethodsTypes.TeammatesOpenThreadParams(teammateId, threadId, fresh.takeIf { it }),
    )
    _threadsById.update { map ->
      val rest = map[teammateId].orEmpty().filter { it.id != opened.thread.id }
      map + (teammateId to listOf(opened.thread) + rest)
    }
    _error.value = null
    opened
  } catch (e: Exception) {
    fail("Couldn't open that conversation", e)
    null
  }
}

suspend fun TeammatesStore.archiveThread(teammateId: String, threadId: String): Boolean {
  val backend = host.backend ?: return false
  return try {
    backend.request(Methods.TeammatesArchiveThread, MethodsTypes.TeammatesArchiveThreadParams(threadId))
    _threadsById.update { map -> map[teammateId]?.let { list -> map + (teammateId to list.filter { it.id != threadId }) } ?: map }
    true
  } catch (e: Exception) {
    fail("Couldn't archive that conversation", e)
    false
  }
}

suspend fun TeammatesStore.loadMemories(teammateId: String) {
  val backend = host.backend ?: return
  try {
    val memories = backend.request(Methods.TeammatesMemories, MethodsTypes.TeammatesMemoriesParams(teammateId)).memories
    _memoriesById.update { it + (teammateId to memories) }
  } catch (e: Exception) {
    fail("Couldn't read that teammate's memories", e)
  }
}

/** Create or overwrite; [previousName] renames the memory it was opened as. */
suspend fun TeammatesStore.saveMemory(teammateId: String, memory: RemoteAutomationMemory, previousName: String?): Boolean {
  val backend = host.backend ?: return false
  return try {
    backend.request(
      Methods.TeammatesSaveMemory,
      MethodsTypes.TeammatesSaveMemoryParams(
        teammateId,
        MethodsTypes.TeammatesSaveMemoryParamsMemory(
          name = memory.name, description = memory.description,
          type = MethodsTypes.TeammatesSaveMemoryParamsMemoryType(memory.type.rawValue), body = memory.body,
          previousName = previousName,
        ),
      ),
    )
    _error.value = null
    loadMemories(teammateId)
    true
  } catch (e: Exception) {
    fail("Couldn't save that memory", e)
    false
  }
}

suspend fun TeammatesStore.deleteMemory(teammateId: String, name: String): Boolean {
  val backend = host.backend ?: return false
  return try {
    backend.request(Methods.TeammatesDeleteMemory, MethodsTypes.TeammatesDeleteMemoryParams(teammateId, name))
    _memoriesById.update { map -> map[teammateId]?.let { list -> map + (teammateId to list.filter { it.name != name }) } ?: map }
    true
  } catch (e: Exception) {
    fail("Couldn't delete that memory", e)
    false
  }
}

/** A rewritten soul for the editor; nothing is saved. Null means the computer refused. */
suspend fun TeammatesStore.reviseSoul(name: String, soul: String, instruction: String): String? {
  val backend = host.backend ?: return null
  return try {
    val revised = backend.request(Methods.TeammatesReviseSoul, MethodsTypes.TeammatesReviseSoulParams(name, soul, instruction)).soul
    _error.value = null
    revised
  } catch (e: Exception) {
    fail("Couldn't rewrite the soul", e)
    null
  }
}

/** Make a standalone automation one of [teammateId]'s duties; null makes a new teammate named after it. */
suspend fun TeammatesStore.promote(automationId: String, teammateId: String?): Teammate? {
  val backend = host.backend ?: return null
  return try {
    val teammate = backend.request(Methods.TeammatesPromote, MethodsTypes.TeammatesPromoteParams(automationId, teammateId)).teammate
    _error.value = null
    refresh()
    if (teammate.id in _detailById.value) loadDetail(teammate.id)
    teammate
  } catch (e: Exception) {
    fail("Couldn't give that automation to a teammate", e)
    null
  }
}
