package dev.houwert.argus.ui.composer

import dev.houwert.argus.kit.protocol.generated.RemoteAgentCapabilities
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemotePermissionMode
import dev.houwert.argus.kit.protocol.generated.RemoteRunner
import dev.houwert.argus.kit.storage.PreferenceKey
import dev.houwert.argus.kit.storage.Preferences
import dev.houwert.argus.kit.util.ContextWindow
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * The composer's state and actions: the draft (text, images, files, linked projects), the `/`
 * and `@` menus, the model, effort, mode and account pickers, and sending, queueing or starting.
 * The views only render it. Getters read the host's flows; a view collects [observed] to recompose.
 */
class ComposerModel(
  /** Null in a start composer: there's no agent yet. */
  agentId: String?,
  val sessionId: String?,
  internal val host: ComposerHost,
  /** Outlives the screen, so a send in flight isn't cancelled by leaving it. */
  internal val scope: CoroutineScope,
  /** Set: there's no agent yet, and sending starts one. Its readiness moves, so the view refreshes it. */
  starter: ComposerStarter? = null,
  internal val preferences: Preferences = ComposerDrafts.preferences,
  internal val draftImages: DraftAttachments = ComposerDrafts.images,
  /** Takes `handsFree`: voice mode's listening, which keeps going through silences. */
  internal val dictationEngine: ((Boolean) -> DictationEngine)? = null,
  var onAffordance: ((ChatInputAffordance) -> Unit)? = null,
  /** Null: no voice mode here. */
  internal val voice: VoiceEnvironment? = null,
) {
  init {
    require(agentId != null || starter != null) { "A composer without an agent needs a starter" }
  }

  var starter: ComposerStarter? = starter
    set(value) {
      require((field == null) == (value == null)) { "A composer can't switch between starting and sending" }
      field = value
    }

  /** The agent, or the start draft's key. */
  val agentId: String = agentId ?: ComposerStarter.draftKey(sessionId)

  internal val _text = MutableStateFlow("")
  val text: StateFlow<String> = _text.asStateFlow()
  /** Offset of the insertion point (UTF-16, as String indexes). */
  internal val _caret = MutableStateFlow(0)
  val caret: StateFlow<Int> = _caret.asStateFlow()
  internal val _images = MutableStateFlow(emptyList<PendingImage>())
  val images: StateFlow<List<PendingImage>> = _images.asStateFlow()
  /** Non-image files; like elements they ride the composer, not the saved draft. */
  internal val _files = MutableStateFlow(emptyList<PendingFile>())
  val files: StateFlow<List<PendingFile>> = _files.asStateFlow()
  internal val _elements = MutableStateFlow(emptyList<PickedElement>())
  val elements: StateFlow<List<PickedElement>> = _elements.asStateFlow()
  internal val _linkedProjects = MutableStateFlow(emptyList<String>())
  val linkedProjects: StateFlow<List<String>> = _linkedProjects.asStateFlow()
  /** Esc closes a menu until the text changes again. */
  internal val dismissedText = MutableStateFlow<String?>(null)
  internal val _menuIndex = MutableStateFlow(0)
  val menuIndex: StateFlow<Int> = _menuIndex.asStateFlow()
  internal val mentionFiles = MutableStateFlow(emptyList<String>())
  internal val mentionDirectories = MutableStateFlow(emptyList<String>())
  internal val browseDirectory = MutableStateFlow<String?>(null)
  internal val browseEntries = MutableStateFlow(emptyList<MentionPicker.Entry>())
  /** Browse lookups race the typing; only the newest may land. */
  private var browseRequest = 0
  private var lastMentionQuery: String? = null
  /** `/model` with no argument asks the view to open its model picker. */
  internal val _showingModelPicker = MutableStateFlow(false)
  val showingModelPicker: StateFlow<Boolean> = _showingModelPicker.asStateFlow()
  /** A start composer's picks, handed to the agent it starts. */
  internal val draftMode = MutableStateFlow<RemotePermissionMode?>(null)
  internal val draftModel = MutableStateFlow<String?>(null)
  internal val draftEffort = MutableStateFlow<String?>(null)
  /** A start's account pick; null keeps the session's own pin. */
  internal val draftAccount = MutableStateFlow<String?>(null)
  /** A start composer's runner; null is the computer's default. */
  internal val _runner = MutableStateFlow<RemoteRunner?>(null)
  val runner: StateFlow<RemoteRunner?> = _runner.asStateFlow()
  /** A start that can't carry images or effort (one per Linear issue) hides both. */
  val offersImagesAndEffort = MutableStateFlow(true)
  internal val _starting = MutableStateFlow(false)
  val starting: StateFlow<Boolean> = _starting.asStateFlow()
  internal val _dictation = MutableStateFlow<DictationPhase>(DictationPhase.Idle)
  val dictation: StateFlow<DictationPhase> = _dictation.asStateFlow()
  internal var dictationRun: DictationRun? = null
  /** Hands-free: replies read aloud, then the microphone opens and a pause sends. */
  internal val _voiceMode = MutableStateFlow(voice != null && starter == null && VoiceSettings.isModeOn(preferences))
  val voiceMode: StateFlow<Boolean> = _voiceMode.asStateFlow()
  internal val _speaking = MutableStateFlow(false)
  val speaking: StateFlow<Boolean> = _speaking.asStateFlow()
  internal var voiceSynthesizer: SpeechSynthesizer? = null
  internal var voiceHandledCue: String? = null
  internal var voiceArmed = false
  internal var voiceJob: Job? = null
  internal var voiceTimer: Job? = null

  /** Everything the getters read, the host's and the model's own. */
  val observed: List<StateFlow<*>> = host.observed + listOf(
    _text, _caret, _images, _files, _elements, _linkedProjects, dismissedText, _menuIndex, mentionFiles,
    mentionDirectories, browseDirectory, browseEntries, _showingModelPicker, draftMode, draftModel, draftEffort,
    draftAccount, _runner, offersImagesAndEffort, _starting, _dictation, _voiceMode, _speaking,
  )

  // Agent

  val status: RemoteAgentStatus? get() = host.statusByAgent.value[agentId]
  val isRunning: Boolean get() = status?.status == RemoteAgentStatusStatus.running

  /** The phone takes input even for a stopped agent: sending wakes it. */
  val isEnabled: Boolean get() = !_starting.value

  /** A side question forks the conversation, so an agent with nothing said yet has none to ask about. */
  val hasConversation: Boolean get() = starter == null && host.visibleMessages(agentId).isNotEmpty()

  /** A start composer offers the CLI its start will take; an agent, its own. */
  val capabilities: RemoteAgentCapabilities
    get() {
      if (starter != null && sessionId != null) return host.startOptionsBySession.value[sessionId] ?: EMPTY_CAPABILITIES
      return host.capabilitiesByAgent.value[agentId] ?: EMPTY_CAPABILITIES
    }

  internal val trimmedText: String get() = _text.value.trim()

  val hasContent: Boolean
    get() = trimmedText.isNotEmpty() || _images.value.isNotEmpty() || _elements.value.isNotEmpty() || _files.value.isNotEmpty()

  /** A send waits for every file to reach the session's machine. */
  val isUploadingFiles: Boolean get() = _files.value.any { it.isUploading }

  /** Where sending starts an agent, when it doesn't go to the one here. */
  internal fun sendTarget(redirect: ComposerStarter?) = redirect ?: starter

  fun canSend(redirect: ComposerStarter? = null): Boolean {
    // Dictated words land for review; nothing goes out mid-sentence.
    if (_dictation.value.isActive || isUploadingFiles) return false
    val target = sendTarget(redirect)
    if (target?.ready == false) return false
    if (!hasContent && target?.needsContent != false) return false
    return target?.needsText != true || trimmedText.isNotEmpty()
  }

  /** Replies suggested once the last turn ended, while the agent waits. */
  val followUps: List<String>
    get() = if (!isEnabled || isRunning) emptyList() else host.followUpsByAgent.value[agentId].orEmpty()

  /** The most recent assistant turn carrying usage is the live figure. */
  val contextTokens: Int
    get() = ContextWindow.tokensInContext(host.visibleMessages(agentId).lastOrNull { it.usage != null }?.usage)

  val contextLimit: Int
    get() = status?.contextWindow?.toInt() ?: ContextWindow.limit(status?.model, capabilities)

  // Menus

  /** `/usage-limits` joins once the usage store is ported; until then it goes to the CLI. */
  val commands: List<SlashCommandMenu.Command>
    get() = SlashCommandMenu.merged(capabilities.commands.map(SlashCommandMenu::Command))

  val slashItems: List<SlashCommandMenu.Command>
    get() = if (dismissedText.value == _text.value) emptyList() else SlashCommandMenu.suggestions(_text.value, commands)

  val mentionContext: MentionPicker.Context?
    get() = if (dismissedText.value == _text.value) null else MentionPicker.detect(_text.value, _caret.value)

  val mentionItems: List<MentionPicker.Item>
    get() {
      val context = mentionContext ?: return emptyList()
      if (!MentionPicker.isBrowsing(context.query)) {
        return MentionPicker.search(mentionFiles.value, mentionDirectories.value, context.query)
      }
      val (directory, filter) = MentionPicker.splitBrowse(context.query)
      if (browseDirectory.value != directory) return emptyList()
      return MentionPicker.browse(directory, browseEntries.value, filter)
    }

  val mentionHeader: String get() = mentionContext?.let(MentionPicker::header) ?: "Files"

  internal val menuCount: Int get() = slashItems.ifEmpty { null }?.size ?: mentionItems.size

  /** After an accepted `/command `, its argument hint; else the rest of a typed-into follow-up. */
  val argumentHint: String?
    get() = SlashCommandMenu.argumentHint(_text.value, commands) ?: FollowUps.completion(_text.value, followUps)

  /** The field's edit: the draft is saved with each change, and a moved caret may open the `@` menu. */
  fun setText(value: String, caret: Int = value.length) {
    val changed = value != _text.value
    _text.value = value
    _caret.value = caret.coerceIn(0, value.length)
    if (changed) {
      if (value.isEmpty()) preferences.remove(PreferenceKey.draft(agentId)) else preferences.set(value, PreferenceKey.draft(agentId))
      if (dismissedText.value != value) dismissedText.value = null
      _menuIndex.value = 0
    }
    mentionMayHaveMoved()
  }

  fun setCaret(value: Int) {
    if (value == _caret.value) return
    _caret.value = value.coerceIn(0, _text.value.length)
    mentionMayHaveMoved()
  }

  fun pickerShown() {
    _showingModelPicker.value = false
  }

  private fun mentionMayHaveMoved() {
    val query = mentionContext?.query
    if (query == lastMentionQuery) return
    lastMentionQuery = query
    scope.launch { refreshBrowse() }
  }

  internal suspend fun refreshBrowse() {
    val context = mentionContext ?: return
    val sessionId = sessionId ?: return
    if (!MentionPicker.isBrowsing(context.query)) return
    val directory = MentionPicker.splitBrowse(context.query).first
    if (directory == browseDirectory.value) return
    val request = ++browseRequest
    val result = host.resolveMentionPath(sessionId, directory)
    if (request != browseRequest) return
    browseEntries.value = result?.entries.orEmpty().map { MentionPicker.Entry(it.name, it.isDir) }
    browseDirectory.value = directory
  }

  fun acceptFollowUp(reply: String) {
    onAffordance?.invoke(ChatInputAffordance.FollowUp)
    setText(reply)
  }

  fun acceptSlash(command: SlashCommandMenu.Command) {
    onAffordance?.invoke(ChatInputAffordance.SlashCommand)
    setText(SlashCommandMenu.accepted(command))
  }

  fun acceptMention(item: MentionPicker.Item) {
    val context = mentionContext ?: return
    if (!item.isDirectory || item.isLinkAction) onAffordance?.invoke(ChatInputAffordance.Mention)
    val edit = MentionPicker.apply(item, context, _text.value)
    setText(edit.text, edit.caret)
  }

  /** Returns whether the key was handled, as [ComposerKeymap] decides it. */
  fun handle(key: ComposerKey, redirect: ComposerStarter? = null): Boolean {
    val followUp = FollowUps.accepted(_text.value, followUps)
    when (val action = ComposerKeymap.action(key, menuCount > 0, isRunning, followUp != null)) {
      ComposerKeyAction.PassThrough -> return false
      ComposerKeyAction.Ignore -> Unit
      ComposerKeyAction.Send -> submit(redirect)
      is ComposerKeyAction.MenuMove -> _menuIndex.value = ComposerKeymap.move(_menuIndex.value, action.delta, menuCount)
      ComposerKeyAction.MenuAccept -> {
        val slash = slashItems
        val index = _menuIndex.value
        if (slash.isNotEmpty()) slash.getOrNull(index)?.let(::acceptSlash)
        else mentionItems.getOrNull(index)?.let(::acceptMention)
      }
      ComposerKeyAction.MenuDismiss -> dismissedText.value = _text.value
      ComposerKeyAction.CyclePermissionMode -> {
        onAffordance?.invoke(ChatInputAffordance.PermissionCycle)
        setPermissionMode(ComposerPermissionMode.next(permissionMode))
      }
      ComposerKeyAction.Interrupt -> {
        onAffordance?.invoke(ChatInputAffordance.InterruptShortcut)
        interrupt()
      }
      ComposerKeyAction.AcceptFollowUp -> followUp?.let(::acceptFollowUp)
    }
    return true
  }

  companion object {
    val EMPTY_CAPABILITIES = RemoteAgentCapabilities(models = emptyList(), commands = emptyList(), agents = emptyList())

    /** A stopped agent's last status can still carry the continue it had queued. */
    fun pendingLimitResume(status: RemoteAgentStatus?): Double? {
      if (status == null || status.status == RemoteAgentStatusStatus.stopped || status.status == RemoteAgentStatusStatus.error) return null
      return status.limitResumeAt
    }
  }
}
