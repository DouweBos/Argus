package dev.houwert.argus.ui.gallery

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.SideQuestion
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.storage.InMemoryKeyValueStore
import dev.houwert.argus.kit.storage.PreferenceKey
import dev.houwert.argus.kit.storage.Preferences
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.composer.ChatInputView
import dev.houwert.argus.ui.composer.ComposerModel
import dev.houwert.argus.ui.composer.ComposerScope
import dev.houwert.argus.ui.composer.ComposerStarter
import dev.houwert.argus.ui.composer.DraftAttachments
import dev.houwert.argus.ui.composer.ImageAttachments
import dev.houwert.argus.ui.composer.LimitHandoffCard
import dev.houwert.argus.ui.composer.PickedFile
import dev.houwert.argus.ui.composer.SideQuestionPanel
import dev.houwert.argus.ui.composer.attachFiles
import dev.houwert.argus.ui.composer.rememberRecognizerDictation
import dev.houwert.argus.ui.theme.ArgusTheme
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer

/** Stories for the Composer page. */
@Composable
internal fun ComposerGalleryPage() {
  val theme = ArgusTheme.colors
  Story("Empty") { ComposerStory(GalleryComposerHost(talked = false)) }
  Story("Typing a command") { ComposerStory(GalleryComposerHost(), draft = "/re") }
  Story("Mentioning a file") { ComposerStory(GalleryComposerHost(), draft = "Look at @app") }
  Story("Two images and a file") {
    val images = remember(theme) { listOf(swatch(theme.accent.toArgb(), theme.success.toArgb()), swatch(theme.warning.toArgb(), theme.error.toArgb())) }
    ComposerStory(GalleryComposerHost(), draft = "Why does the header overflow here?", images = images, withFile = true)
  }
  Story("Running, queue and stop") {
    ComposerStory(GalleryComposerHost(RemoteAgentStatusStatus.running), draft = "Also update the docs")
  }
  Story("Model, effort and mode pills") {
    ComposerStory(GalleryComposerHost(permissionMode = "plan"), linked = listOf("/Users/me/Work/website", "/Users/me/Work/docs"))
  }
  Story("Suggested replies") {
    ComposerStory(GalleryComposerHost(followUps = listOf("Yes, add the tests", "Commit it", "Open a pull request")))
  }
  Story("Limit handoff card") {
    val host = remember { GalleryComposerHost(stalled = true, handoffAccounts = GalleryComposerHost.handoff(System.currentTimeMillis())) }
    ComposerStory(host)
  }
  Story("Limit handoff card, alone") {
    val host = remember { GalleryComposerHost(stalled = true) }
    LimitHandoffCard(host, GalleryComposerHost.AGENT, GalleryComposerHost.handoff(System.currentTimeMillis()), host.runners.value) {}
  }
  Story("Side question panel") {
    val host = remember {
      GalleryComposerHost(
        sideQuestions = listOf(
          SideQuestion("q1", "Which file holds the gateway's frame limit?", "`packages/host/src/services/file/uploads.ts`: 8 MiB of base64 per envelope.", sent = true),
          SideQuestion("q2", "Is the queue flushed on reconnect?", "Yes. `resyncQueues` reloads every agent's queue once the transport is ready again."),
          SideQuestion("q3", "What does ultracode change?"),
        ),
      )
    }
    SideQuestionPanel(host, GalleryComposerHost.AGENT, Modifier.padding(4.dp))
  }
  Story("Start composer") {
    val host = remember { GalleryComposerHost(talked = false) }
    val composer = remember {
      ComposerModel(
        null, GalleryComposerHost.SESSION, host, ComposerScope,
        ComposerStarter("auto", placeholder = "Describe the task; the branch is named from it", needsText = true) { true },
        Preferences(InMemoryKeyValueStore()), DraftAttachments(),
      )
    }
    ChatInputView(composer, footer = { MutedText("New worktree from main", Modifier.padding(top = 6.dp)) })
  }
}

@Composable
private fun ComposerStory(
  host: GalleryComposerHost,
  draft: String = "",
  images: List<ByteArray> = emptyList(),
  linked: List<String> = emptyList(),
  withFile: Boolean = false,
) {
  val dictation = rememberRecognizerDictation()
  val composer = remember(host) {
    val preferences = Preferences(InMemoryKeyValueStore())
    preferences.set(draft, PreferenceKey.draft(GalleryComposerHost.AGENT))
    if (linked.isNotEmpty()) {
      preferences.encode(linked, ListSerializer(String.serializer()), PreferenceKey.linkedProjects(GalleryComposerHost.AGENT))
    }
    val drafts = DraftAttachments()
    drafts.save(images.mapNotNull { ImageAttachments.pending(it)?.attachment }, GalleryComposerHost.AGENT)
    ComposerModel(GalleryComposerHost.AGENT, GalleryComposerHost.SESSION, host, ComposerScope, null, preferences, drafts, dictation)
  }
  if (withFile) {
    LaunchedEffect(composer) { composer.attachFiles(listOf(PickedFile("design-review.pdf", 482_000) { ByteArray(0) })) }
  }
  Column { ChatInputView(composer) }
}

/** A two-tone screenshot stand-in, as PNG bytes. */
private fun swatch(top: Int, bottom: Int): ByteArray {
  val bitmap = Bitmap.createBitmap(160, 120, Bitmap.Config.ARGB_8888)
  val canvas = Canvas(bitmap)
  canvas.drawColor(top)
  canvas.drawRect(0f, 70f, 160f, 120f, Paint().apply { color = bottom })
  val out = java.io.ByteArrayOutputStream()
  bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
  return out.toByteArray()
}
