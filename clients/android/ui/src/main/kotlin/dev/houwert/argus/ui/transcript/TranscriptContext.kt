package dev.houwert.argus.ui.transcript

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.staticCompositionLocalOf
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.transcript.FileLinks
import dev.houwert.argus.core.transcript.PendingPrompts
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemoteMessageDutyRun
import dev.houwert.argus.kit.protocol.generated.RemoteToolCall
import dev.houwert.argus.kit.util.ArtifactLink
import kotlinx.coroutines.CoroutineScope

/**
 * What every transcript row reads from the screen around it: the Swift views' environment
 * (`HostStore`, `openFileLink`, `openArtifact`, `messageMenu`, `autoExpandImageReads`).
 */
@Stable
class TranscriptEnvironment(
  val host: HostStore,
  val agentKey: String,
  val openFileLink: ((FileLinks.FileRef) -> Unit)? = null,
  val openArtifact: ((ArtifactLink) -> Unit)? = null,
  val messageMenu: MessageMenu? = null,
  val autoExpandImageReads: Boolean = false,
  val imageViewer: ImageViewerState = ImageViewerState(),
  /** Which tool cards were opened or closed by hand; a lazy list recycles rows, so it can't live in them. */
  val toolExpansion: MutableMap<String, Boolean> = mutableStateMapOf(),
  /** Outlives the rows: an answered form leaves the screen before its request lands. */
  val scope: CoroutineScope,
  /** Opens a teammate duty run's report; unset, its divider has no button. */
  val openDutyRun: ((RemoteMessageDutyRun) -> Unit)? = null,
)

val LocalTranscript = staticCompositionLocalOf<TranscriptEnvironment?> { null }

/** Opens a tapped file path; unset, paths stay plain text. Markdown outside a transcript reads it too. */
val LocalOpenFileLink = staticCompositionLocalOf<((FileLinks.FileRef) -> Unit)?> { null }

/**
 * The store's prompt state, snapshotted once per transcript so rows decide "pending" without each
 * subscribing to three flows. Changes rarely: a prompt arrives or is answered.
 */
@Immutable
data class PendingSnapshot(
  val agentKey: String = "",
  val promptKeys: Set<String> = emptySet(),
  val answered: Set<String> = emptySet(),
  val agentState: RemoteAgentStatusStatus? = null,
) {
  fun isPending(call: RemoteToolCall): Boolean =
    PendingPrompts.isToolCallPending(agentKey, call, promptKeys, answered, agentState)

  fun hasPendingCall(call: RemoteToolCall): Boolean = PendingPrompts.hasPendingCall(call, ::isPending)
}

val LocalPending = compositionLocalOf { PendingSnapshot() }

internal val transcriptEnvironment: TranscriptEnvironment
  @Composable get() = LocalTranscript.current ?: error("Transcript views need a TranscriptEnvironment")
