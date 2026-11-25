package dev.houwert.argus.ui.composer

import dev.houwert.argus.core.sessions.ComposerStart
import dev.houwert.argus.kit.protocol.generated.RemoteImageAttachment
import dev.houwert.argus.kit.protocol.generated.RemotePermissionMode
import dev.houwert.argus.kit.storage.PreferenceKey
import dev.houwert.argus.kit.util.LinkedProjects
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer

// Sending, queueing and starting, the draft's load and save, and attachments.

/** A busy agent takes the message into its running turn; `afterTurn` holds it in the queue until the turn ends. */
fun ComposerModel.submit(redirect: ComposerStarter? = null, afterTurn: Boolean = false) {
  if (!isEnabled || dictation.value.isActive || isUploadingFiles) return
  if (!hasContent && sendTarget(redirect)?.needsContent != false) return
  val typed = trimmedText
  val images = images.value
  val elements = elements.value
  val files = files.value

  // Handled here rather than sent to the CLI.
  val local = SlashCommandMenu.local(typed)
  if (images.isEmpty() && elements.isEmpty() && files.isEmpty() && linkedProjects.value.isEmpty() && local != null &&
    local != SlashCommandMenu.Local.ShowUsageLimits
  ) {
    clearComposer()
    when (local) {
      SlashCommandMenu.Local.TogglePlan ->
        setPermissionMode(if (permissionMode == RemotePermissionMode.plan) RemotePermissionMode.auto else RemotePermissionMode.plan)
      is SlashCommandMenu.Local.SetModel ->
        if (starter != null) draftModel.value = local.model else scope.launch { host.setModel(agentId, local.model) }
      SlashCommandMenu.Local.OpenModelPicker -> _showingModelPicker.value = true
      SlashCommandMenu.Local.ShowUsageLimits -> Unit
    }
    return
  }

  var display = if (typed.isEmpty() && images.isNotEmpty() && files.isEmpty()) "(see attached images)" else typed
  PendingFile.mentions(files)?.let { mentions -> display = if (display.isEmpty()) mentions else "$display\n\n$mentions" }
  var message = display
  if (elements.isNotEmpty()) {
    message = PickedElement.body(display, elements)
    display = PickedElement.display(display, elements)
  }
  val links = linkedProjects.value
  val body = if (message.isEmpty()) "" else LinkedProjects.buildPreamble(links, message)
  // Shown instead of the context blocks; the preamble stays, the transcript draws it as chips.
  val shown = if (elements.isEmpty()) null else LinkedProjects.buildPreamble(links, display)
  val attachments = elements.mapNotNull { it.crop } + images.map { it.attachment }
  sendTarget(redirect)?.let { target ->
    if (!canSend(redirect)) return
    return start(target, body, display, attachments)
  }
  val queue = afterTurn && isRunning
  clearComposer()
  clearLinks()
  val agentId = agentId
  scope.launch {
    // The bubble keeps the preamble: the transcript draws it as linked-project chips.
    // A plain send can still come back queued (a pending prompt, a paused agent); the store reloads the queue then.
    if (queue) host.queueMessage(agentId, body, attachments, shown ?: body)
    else host.sendMessage(agentId, body, attachments, shown)
  }
}

/** Starts the agent; the draft stays put until it has. */
private fun ComposerModel.start(target: ComposerStarter, body: String, display: String, attachments: List<RemoteImageAttachment>) {
  _starting.value = true
  // Redirected from a live agent, the new one takes this one's settings.
  val live = starter == null
  val withImages = offersImagesAndEffort.value
  val request = ComposerStart(
    message = body,
    displayText = display,
    images = if (withImages) attachments else emptyList(),
    permissionMode = draftMode.value ?: if (live) permissionMode else null,
    model = draftModel.value ?: if (live) status?.model else null,
    effort = if (withImages) draftEffort.value ?: if (live) host.effortByAgent.value[agentId] else null else null,
    runnerId = runner.value?.id,
    accountId = if (starter != null && offersAccounts) draftAccount.value else null,
  )
  scope.launch {
    val started = try {
      target.start(request)
    } finally {
      _starting.value = false
    }
    if (!started) return@launch
    clearComposer()
    clearLinks()
    draftMode.value = null
    draftModel.value = null
    draftEffort.value = null
    draftAccount.value = null
  }
}

private fun ComposerModel.clearComposer() {
  setText("", 0)
  _images.value = emptyList()
  _elements.value = emptyList()
  _files.value = emptyList()
  preferences.remove(PreferenceKey.draft(agentId))
  draftImages.remove(agentId)
}

/** A link rides one message, not every one after it. */
private fun ComposerModel.clearLinks() {
  _linkedProjects.value = emptyList()
  preferences.remove(PreferenceKey.linkedProjects(agentId))
}

internal val linkedSerializer = ListSerializer(String.serializer())

/** Restores the draft, then fetches what the menus and pickers offer. */
suspend fun ComposerModel.load() {
  val draft = preferences.string(PreferenceKey.draft(agentId)).orEmpty()
  setText(draft, draft.length)
  _images.value = draftImages.load(agentId).map { PendingImage(it) }
  _linkedProjects.value = preferences.decode(PreferenceKey.linkedProjects(agentId), linkedSerializer).orEmpty()
  // Files first: capabilities wait on the CLI's first turn.
  sessionId?.let { sessionId ->
    val files = host.listFiles(sessionId)
    mentionFiles.value = files
    mentionDirectories.value = MentionPicker.directories(files)
    // The account picker reads the session's pin and the account list.
    if (host.claudeAccounts.value == null) host.refreshClaudeAccounts()
    val repoRoot = host.repoRoot(sessionId)
    if (host.claudeAccountId(sessionId) == null && repoRoot != null && host.sessionsByRepo.value[repoRoot] == null) {
      host.loadSessions(repoRoot)
    }
  }
  if (starter != null) {
    sessionId?.let { host.loadStartOptions(it, null) }
    return
  }
  host.loadQueue(agentId)
  host.loadCapabilities(agentId)
}

// Images

/** Picked, pasted or shot images; `via` reports how, when the host can't tell. */
fun ComposerModel.attach(pending: List<PendingImage>, via: ChatInputAffordance? = null) {
  if (pending.isEmpty()) return
  via?.let { onAffordance?.invoke(it) }
  _images.value = _images.value + pending
  saveImages()
}

fun ComposerModel.removeImage(id: String) {
  _images.value = _images.value.filterNot { it.id == id }
  saveImages()
}

/** Images ride the draft as its text does, so a switch away or a relaunch keeps them. */
private fun ComposerModel.saveImages() = draftImages.save(_images.value.map { it.attachment }, agentId)

// Files

/** A non-image file picked to attach: its name and bytes, read where only this device can reach. */
class PickedFile(val name: String, val size: Long, val read: () -> ByteArray?)

/** A chip each while it reaches the session's machine, dropped if it can't. */
fun ComposerModel.attachFiles(picked: List<PickedFile>) {
  if (picked.isEmpty()) return
  onAffordance?.invoke(ChatInputAffordance.FileAttach)
  for (item in picked) {
    val pending = PendingFile(item.name, item.size)
    _files.value = _files.value + pending
    scope.launch {
      val path = host.hostPath(item.name, item.size, item.read, sessionId)
      val current = _files.value
      if (current.none { it.id == pending.id }) return@launch
      _files.value = if (path != null) current.map { if (it.id == pending.id) it.copy(path = path) else it }
      else current.filterNot { it.id == pending.id }
    }
  }
}

fun ComposerModel.removeFile(id: String) {
  _files.value = _files.value.filterNot { it.id == id }
}

// Elements

fun ComposerModel.attach(element: PickedElement) {
  _elements.value = _elements.value + element
}

fun ComposerModel.removeElement(id: String) {
  _elements.value = _elements.value.filterNot { it.id == id }
}
