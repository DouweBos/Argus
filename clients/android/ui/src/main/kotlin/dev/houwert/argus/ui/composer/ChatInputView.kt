package dev.houwert.argus.ui.composer

import dev.houwert.argus.core.sessions.ComposerStart
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.storage.Preferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.MainScope

/**
 * The chat input: send or queue a message, attach images and files, switch model, account,
 * permission mode and effort, and link other projects. With `agentId` null and a `starter`, it's
 * a start composer: sending hands a [ComposerStart] to the starter instead.
 *
 * Only shown to a device holding the control grant; the gateway refuses every one of these otherwise.
 */
@Composable
fun ChatInputView(
  host: HostStore,
  agentId: String?,
  sessionId: String?,
  modifier: Modifier = Modifier,
  starter: ComposerStarter? = null,
  redirect: ComposerStarter? = null,
  footer: (@Composable () -> Unit)? = null,
  typing: ComposerTyping? = null,
  preferences: Preferences = ComposerDrafts.preferences,
  draftImages: DraftAttachments = ComposerDrafts.images,
  onAffordance: ((ChatInputAffordance) -> Unit)? = null,
  onOpenContinuedAgent: ((RemoteAgentStatus) -> Unit)? = null,
) {
  val composerHost = remember(host) { host.asComposerHost() }
  val composer = rememberComposerModel(composerHost, agentId, sessionId, starter, preferences, draftImages, onAffordance)
  PhoneChatInputView(composer, modifier, redirect, footer, typing, onOpenContinuedAgent)
}

/** Over a host the caller holds: a fake in the gallery, or a start pane keeping its own model. */
@Composable
fun ChatInputView(
  composer: ComposerModel,
  modifier: Modifier = Modifier,
  redirect: ComposerStarter? = null,
  footer: (@Composable () -> Unit)? = null,
  typing: ComposerTyping? = null,
  onOpenContinuedAgent: ((RemoteAgentStatus) -> Unit)? = null,
) = PhoneChatInputView(composer, modifier, redirect, footer, typing, onOpenContinuedAgent)

/** A model per agent: switching agents starts a fresh composer over that agent's draft. */
@Composable
fun rememberComposerModel(
  host: ComposerHost,
  agentId: String?,
  sessionId: String?,
  starter: ComposerStarter? = null,
  preferences: Preferences = ComposerDrafts.preferences,
  draftImages: DraftAttachments = ComposerDrafts.images,
  onAffordance: ((ChatInputAffordance) -> Unit)? = null,
  dictation: (() -> DictationEngine)? = rememberRecognizerDictation(),
): ComposerModel {
  val composer = remember(host, agentId, sessionId, starter == null) {
    ComposerModel(agentId, sessionId, host, ComposerScope, starter, preferences, draftImages, dictation, onAffordance)
  }
  SideEffect {
    composer.onAffordance = onAffordance
    if (starter != null) composer.starter = starter
  }
  return composer
}

/** Sends outlive the screen that started them, as a Swift Task outlives its view. */
internal val ComposerScope: CoroutineScope = MainScope()
