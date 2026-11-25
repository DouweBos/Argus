package dev.houwert.argus.ui.composer

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.NonRestartableComposable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.SubcomposeLayout
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.ContextMeter
import dev.houwert.argus.ui.components.FlatIconButton
import dev.houwert.argus.ui.components.ReadingColumn
import androidx.compose.foundation.layout.widthIn
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import kotlinx.coroutines.launch

/**
 * The phone chat input: menus and suggestions above, then one rounded card with the
 * attachments, the field, and the agent's settings as pills beside attach and send. With a
 * starter it's a start composer, and `footer` tucks a strip under the card.
 */
@Composable
fun PhoneChatInputView(
  composer: ComposerModel,
  modifier: Modifier = Modifier,
  redirect: ComposerStarter? = null,
  footer: (@Composable () -> Unit)? = null,
  typing: ComposerTyping? = null,
  onOpenContinuedAgent: ((RemoteAgentStatus) -> Unit)? = null,
) {
  composer.observe()
  val host = composer.host
  val theme = ArgusTheme.colors
  val scope = rememberCoroutineScope()
  var keyboardMenu by remember(composer) { mutableStateOf(false) }
  var picker by remember(composer) { mutableStateOf<PhoneComposerPicker?>(null) }
  val text by composer.text.collectAsState()
  val status = composer.status
  val (handoffAccounts, dropOffer) = rememberLimitHandoffOffer(host, composer.agentId, status)

  LaunchedEffect(composer) { composer.load() }
  // Which affordances the agent's runner supports.
  LaunchedEffect(host) { host.loadRunners() }
  DisposableEffect(composer) { onDispose { composer.stopDictation() } }
  VoiceLoop(composer)
  LaunchedEffect(composer, text.isEmpty()) { if (composer.starter == null) typing?.invoke(composer.agentId, text.isNotEmpty()) }
  val wantsModelPicker by composer.showingModelPicker.collectAsState()
  LaunchedEffect(wantsModelPicker) {
    if (!wantsModelPicker) return@LaunchedEffect
    composer.pickerShown()
    picker = PhoneComposerPicker.Model
  }

  Column(
    modifier
      .fillMaxWidth()
      .background(theme.bg)
      .navigationBarsPadding()
      .padding(start = 10.dp, end = 10.dp, top = 6.dp, bottom = 8.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    // A tablet or unfolded phone keeps a reading column instead of stretching the card edge to edge.
    Column(Modifier.widthIn(max = ReadingColumn.MAX_WIDTH.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      ComposerModel.pendingLimitResume(status)?.let { at ->
        Banner(Labels.limitResumeBanner(at), actionLabel = "Cancel", onAction = {
          scope.launch { host.dismissLimitResume(composer.agentId) }
        })
      }
      val runners = host.continueRunners(composer.agentId)
      if (LimitHandoff.shows(handoffAccounts, status, runners)) {
        LimitHandoffCard(
          host, composer.agentId, handoffAccounts.orEmpty(), if (LimitHandoff.isStalled(status)) runners else emptyList(),
          onContinued = onOpenContinuedAgent, onHandedOff = dropOffer,
        )
      }
      composer.dictation.value.failure?.let { failure ->
        Banner(failure, actionLabel = "Dismiss", onAction = { composer.dismissDictationError() })
      }
      val slash = composer.slashItems
      val mentions = if (slash.isEmpty()) composer.mentionItems else emptyList()
      // Only a hardware keyboard's arrows move a highlight; a finger needs none.
      val highlighted = if (keyboardMenu) composer.menuIndex.value else -1
      when {
        slash.isNotEmpty() -> PhoneSlashList(slash, highlighted = highlighted) { composer.acceptSlash(it) }
        mentions.isNotEmpty() -> PhoneMentionList(composer.mentionHeader, mentions, highlighted = highlighted) { composer.acceptMention(it) }
        !composer.hasContent && composer.followUps.isNotEmpty() -> FollowUpSuggestionRow(composer.followUps) { composer.acceptFollowUp(it) }
      }
      Column {
        ComposerBox(composer, redirect, { if (it == ComposerKey.Up || it == ComposerKey.Down) keyboardMenu = true }) { picker = it }
        if (footer != null) Box(Modifier.padding(horizontal = 12.dp)) { footer() }
      }
    }
  }
  picker?.let { which -> PhoneComposerPickerSheet(composer, which) { picker = null } }
}

@Composable
private fun ComposerBox(composer: ComposerModel, redirect: ComposerStarter?, onArrow: (ComposerKey) -> Unit, onPick: (PhoneComposerPicker) -> Unit) {
  composer.observe()
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(ComposerMetrics.boxRadius)
  val resolver = LocalContext.current.contentResolver
  val scope = rememberCoroutineScope()
  val images = composer.images.value
  val files = composer.files.value
  Column(Modifier.fillMaxWidth().clip(shape).background(theme.surface).border(1.dp, theme.border, shape)) {
    if (images.isNotEmpty() || files.isNotEmpty()) {
      PhoneAttachmentStrip(
        images, files, { composer.removeImage(it) }, { composer.removeFile(it) },
        Modifier.padding(start = 10.dp, end = 10.dp, top = 10.dp),
      )
    }
    key(composer) {
      ComposerField(
        composer,
        placeholder(composer, redirect),
        Modifier.padding(horizontal = 8.dp).padding(top = 6.dp),
        enabled = composer.isEnabled,
        onKey = { onArrow(it); composer.handle(it, redirect) },
        onPasteImages = if (!composer.offersImagesAndEffort.value) null else { uris ->
          scope.launch { composer.attach(readImages(resolver, uris), ChatInputAffordance.ImagePaste) }
        },
      )
    }
    PillsBesideActions(
      Modifier.fillMaxWidth().padding(start = 6.dp, end = 8.dp, bottom = 8.dp),
      pills = { PhoneComposerPills(composer, onPick = onPick) },
      actions = { ComposerActions(composer, redirect) },
    )
  }
}

/** Attach, then send; or, while the agent works, steer it (long-press to wait for the turn) and stop. */
@Composable
private fun ComposerActions(composer: ComposerModel, redirect: ComposerStarter?) {
  composer.observe()
  val theme = ArgusTheme.colors
  var attaching by remember { mutableStateOf(false) }
  Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
    val tokens = composer.contextTokens
    if (tokens > 0) ContextMeter(tokens, composer.contextLimit)
    // Voice mode talks to a live agent; a start composer has none yet.
    if (composer.voice != null && composer.dictationEngine != null && composer.starter == null) {
      VoiceModeButton(composer.voiceMode.value, composer.speaking.value, enabled = composer.isEnabled) { composer.toggleVoiceMode() }
    }
    if (composer.dictationEngine != null) {
      DictationButton(composer.dictation.value, enabled = composer.isEnabled) { composer.toggleDictation() }
    }
    if (composer.offersImagesAndEffort.value) {
      // In a Box so the menu drops from the button rather than the composer's middle.
      Box {
        FlatIconButton(Icon.paperclip, "Attach", size = ComposerMetrics.roundButton, enabled = composer.isEnabled) { attaching = true }
        PhoneAttachMenu(
          attaching, { attaching = false },
          onAttach = { composer.attach(it, ChatInputAffordance.ImageAttach) },
          onAttachFiles = { composer.attachFiles(it) },
        )
      }
    }
    when {
      composer.isRunning -> {
        if (composer.hasContent) BusySendButton(composer)
        ComposerRoundButton(ComposerRoundKind.Stop, "Interrupt") { composer.interrupt() }
      }
      composer.starting.value -> Box(
        Modifier.size(ComposerMetrics.roundButton).semantics { contentDescription = "Starting" },
        contentAlignment = Alignment.Center,
      ) { CircularProgressIndicator(Modifier.size(20.dp), color = theme.textMuted, strokeWidth = 2.dp) }
      else -> ComposerRoundButton(
        ComposerRoundKind.Send, if (composer.starter == null) "Send" else "Start agent",
        enabled = composer.isEnabled && composer.canSend(redirect),
      ) { composer.submit(redirect) }
    }
  }
}

/** "Ask anything" while empty; the field draws a command's hint or a follow-up's rest itself. */
private fun placeholder(composer: ComposerModel, redirect: ComposerStarter?): String =
  composer.dictation.value.placeholder
    ?: if (!composer.isEnabled) "Agent is not running"
    else (redirect ?: composer.starter)?.placeholder ?: "Ask anything, @ for files, / for commands"

/** The model's getters read these flows; collecting them is what recomposes a reader. */
@Composable
@NonRestartableComposable
internal fun ComposerModel.observe() {
  // Non-restartable, so the reads count against the caller's scope; reading the value is what subscribes.
  for (flow in observed) flow.collectAsState().value
}

/**
 * The pills and the actions on one line when the pills fit beside them; otherwise the pills take
 * the full width (wrapping if they must) with the actions under them, rather than squeezing into a column.
 */
@Composable
private fun PillsBesideActions(modifier: Modifier, pills: @Composable () -> Unit, actions: @Composable () -> Unit) {
  SubcomposeLayout(modifier) { constraints ->
    val width = constraints.maxWidth
    val gap = 4.dp.roundToPx()
    val oneRow = ComposerMetrics.pillHeight.roundToPx() + 1
    val action = subcompose("actions", actions).first().measure(constraints.copy(minWidth = 0))
    val beside = subcompose("beside", pills).first().measure(constraints.copy(minWidth = 0, maxWidth = width - gap - action.width))
    if (beside.height <= oneRow) {
      val height = maxOf(beside.height, action.height)
      layout(width, height) {
        beside.placeRelative(0, height - beside.height)
        action.placeRelative(width - action.width, height - action.height)
      }
    } else {
      val above = subcompose("above", pills).first().measure(constraints.copy(minWidth = 0, maxWidth = width))
      layout(width, above.height + action.height) {
        above.placeRelative(0, 0)
        action.placeRelative(width - action.width, above.height)
      }
    }
  }
}
