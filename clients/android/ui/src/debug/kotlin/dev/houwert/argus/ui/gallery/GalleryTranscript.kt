package dev.houwert.argus.ui.gallery

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.util.Base64
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.backend.HostBackend
import dev.houwert.argus.core.backend.HostBackendKind
import dev.houwert.argus.core.backend.HostEvent
import dev.houwert.argus.core.stores.FailedSend
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.loadAgentStatus
import dev.houwert.argus.core.stores.seedImage
import dev.houwert.argus.kit.protocol.RemoteCommand
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemoteBackgroundTask
import dev.houwert.argus.kit.protocol.generated.RemoteBackgroundTaskStatus
import dev.houwert.argus.kit.protocol.generated.RemoteImageRef
import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteMessageRole
import dev.houwert.argus.kit.protocol.generated.RemoteQueuedMessage
import dev.houwert.argus.kit.protocol.generated.RemoteTodo
import dev.houwert.argus.kit.protocol.generated.RemoteTodoStatus
import dev.houwert.argus.kit.protocol.generated.RemoteToolCall
import dev.houwert.argus.kit.protocol.generated.RemoteToolCallStatus
import dev.houwert.argus.kit.protocol.generated.RemoteToolResultBlock
import dev.houwert.argus.kit.protocol.generated.RemoteToolResultBlockText
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.transcript.AgentTranscript
import dev.houwert.argus.ui.transcript.FailedSendCard
import dev.houwert.argus.ui.transcript.LocalTranscript
import dev.houwert.argus.ui.transcript.MarkdownView
import dev.houwert.argus.ui.transcript.TranscriptEnvironment
import dev.houwert.argus.ui.transcript.TranscriptFooterNote
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

private const val AGENT = "gallery-agent"
private const val SCREENSHOT = "gallery:img:0"

/** Stories for the Transcript page: a live chat against a fake computer, then the pieces it can't show at once. */
@Composable
internal fun TranscriptGalleryPage() {
  val host = rememberGalleryHost()
  Story("Agent transcript") {
    Box(
      Modifier.fillMaxWidth().height(640.dp)
        .border(0.5.dp, ArgusTheme.colors.border, RoundedCornerShape(ArgusMetrics.radius)),
    ) {
      AgentTranscript(host, AGENT, Modifier.fillMaxWidth())
    }
  }
  val scope = rememberCoroutineScope()
  val env = remember(host) { TranscriptEnvironment(host, AGENT, scope = scope) }
  CompositionLocalProvider(LocalTranscript provides env) {
    Story("Failed send") {
      FailedSendCard(FailedSend("f1", "Also bump the minimum SDK to 29 while you're in there."))
      FailedSendCard(FailedSend("f2", "Ship it once the tests pass."), waiting = true)
    }
  }
  Story("Markdown") {
    MarkdownView(
      "### Release notes\n\n> Short, present tense, no internals.\n\n1. **Dark mode** follows the system\n2. ~~Old toggle~~ removed\n\n---\n\nSee <https://houwert.dev/argus> for more.",
    )
  }
  Story("Stopped footer") { TranscriptFooterNote("This agent has stopped, so it can't take new messages.") }
}

@Composable
private fun rememberGalleryHost(): HostStore {
  val scope = remember { CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate) }
  val host = remember {
    HostStore(scope).apply {
      setCapabilities(listOf("monitor", "control"))
      seedImage(AGENT, SCREENSHOT, screenshotDataUri())
      attach(TranscriptGalleryBackend)
      scope.launch { loadAgentStatus(AGENT) }
    }
  }
  DisposableEffect(Unit) { onDispose { scope.cancel() } }
  return host
}

/** Answers the few requests a transcript makes, from the fixtures below. */
private object TranscriptGalleryBackend : HostBackend {
  override val kind = HostBackendKind.Gateway

  override fun events(): Flow<HostEvent> = emptyFlow()

  @Suppress("UNCHECKED_CAST")
  override suspend fun <P, R> request(command: RemoteCommand<P, R>, params: P): R = when (command) {
    Methods.AgentsTranscript -> MethodsTypes.AgentsTranscriptResult(
      messages = GalleryTranscript.messages,
      todos = GalleryTranscript.todos,
      pendingToolName = "Bash",
    )
    Methods.AgentsQueueList -> MethodsTypes.AgentsQueueListResult(GalleryTranscript.queued)
    Methods.AgentsStatus -> MethodsTypes.AgentsStatusResult(
      RemoteAgentStatus(AGENT, "gallery-session", status = RemoteAgentStatusStatus.running, title = "Dark mode"),
    )
    else -> error("Not in the gallery")
  } as R

  override suspend fun subscribe(agentId: String, on: Boolean) = Unit

  override suspend fun disconnect() = Unit
}

private object GalleryTranscript {
  private val T0 = System.currentTimeMillis() - 420_000.0

  private fun input(vararg pairs: Pair<String, Any>): Map<String, JsonElement> = pairs.associate { (k, v) -> k to json(v) }

  private fun json(value: Any): JsonElement = when (value) {
    is String -> JsonPrimitive(value)
    is Number -> JsonPrimitive(value)
    is Boolean -> JsonPrimitive(value)
    is List<*> -> JsonArray(value.map { json(it!!) })
    is Map<*, *> -> JsonObject(value.entries.associate { (k, v) -> k as String to json(v!!) })
    else -> error("unsupported")
  }

  private fun call(
    id: String,
    name: String,
    input: Map<String, JsonElement>,
    status: RemoteToolCallStatus = RemoteToolCallStatus.done,
    result: String? = null,
    background: RemoteBackgroundTask? = null,
  ) = RemoteToolCall(
    id, name, input,
    resultBlocks = listOfNotNull(result?.let { RemoteToolResultBlock.Text(RemoteToolResultBlockText("text", it)) }),
    status = status, background = background,
  )

  private fun assistant(id: String, at: Int, text: List<String> = emptyList(), calls: List<RemoteToolCall> = emptyList()) =
    RemoteMessage(id, RemoteMessageRole.assistant, text, calls, timestamp = T0 + at * 1000)

  val messages: List<RemoteMessage> = listOf(
    RemoteMessage(
      "m1", RemoteMessageRole.user,
      listOf("The settings screen looks off in dark mode, see the screenshot. Can you add a theme toggle and document it in the README?"),
      emptyList(), images = listOf(RemoteImageRef(SCREENSHOT, "image/png")), timestamp = T0,
    ),
    assistant("m2", 4, calls = listOf(
      call("c1", "Read", input("file_path" to "src/settings/SettingsScreen.tsx"), result = "export function SettingsScreen() {"),
      call("c2", "Grep", input("pattern" to "useColorScheme", "path" to "src"), result = "src/theme/useTheme.ts:12"),
    )),
    assistant("m3", 31, calls = listOf(
      call(
        "c3", "Edit",
        input(
          "file_path" to "src/settings/SettingsScreen.tsx",
          "old_string" to "      <Row label=\"Notifications\" />\n    </Section>",
          "new_string" to "      <Row label=\"Notifications\" />\n      <ThemeToggle value={theme} onChange={setTheme} />\n    </Section>",
        ),
      ),
    )),
    assistant(
      "m4", 329,
      text = listOf(
        "## Theme toggle\n\nI added a **System / Light / Dark** picker to `SettingsScreen.tsx` and wired it to `useTheme`, so src/theme/useTheme.ts:12 now reads the stored choice first.\n\n" +
          "```ts\nexport function useTheme(): Theme {\n  const stored = usePreference(\"theme\") // \"system\" by default\n  return stored === \"system\" ? systemTheme() : stored\n}\n```\n\n" +
          "| Setting | Default | Stored as |\n|---|---|---|\n| Theme | System | `theme` |\n| Accent | Muted | `accent` |\n\n" +
          "- The README has a new *Appearance* section\n- Nothing changes for people who never open the picker",
      ),
    ),
    RemoteMessage("m5", RemoteMessageRole.user, listOf("Nice. Run the tests and clean the build folder."), emptyList(), timestamp = T0 + 400_000),
    assistant(
      "m6", 405, text = listOf("Running the suite in the background while I update the snapshot."),
      calls = listOf(
        call(
          "c4", "Write", input("file_path" to "src/settings/__snapshots__/SettingsScreen.snap", "content" to "exports[`settings 1`] = `\n<Section>\n  <ThemeToggle />\n</Section>\n`;"),
        ),
        call(
          "c5", "Bash", input("command" to "pnpm test --filter settings", "run_in_background" to true),
          status = RemoteToolCallStatus.running,
          background = RemoteBackgroundTask(RemoteBackgroundTaskStatus.running, startedAt = System.currentTimeMillis() - 74_000.0),
        ),
      ),
    ),
    assistant("m7", 412, calls = listOf(
      call(
        "c6", "AskUserQuestion",
        input(
          "questions" to listOf(
            mapOf(
              "header" to "Default",
              "question" to "Which theme should new installs start on?",
              "multiSelect" to false,
              "options" to listOf(
                mapOf("label" to "System", "description" to "Follow the phone's setting"),
                mapOf("label" to "Dark", "description" to "Always dark until changed"),
              ),
            ),
          ),
        ),
        status = RemoteToolCallStatus.pending,
      ),
    )),
    assistant("m8", 415, calls = listOf(
      call("c7", "Bash", input("command" to "rm -rf build && pnpm build", "description" to "Clean and rebuild"), status = RemoteToolCallStatus.pending),
    )),
  )

  val todos = listOf(
    RemoteTodo("Add the theme picker", RemoteTodoStatus.completed),
    RemoteTodo("Update the snapshot", RemoteTodoStatus.completed),
    RemoteTodo("Run the settings tests", RemoteTodoStatus.inProgress, activeForm = "Running the settings tests"),
    RemoteTodo("Document it in the README", RemoteTodoStatus.pending),
  )

  val queued = listOf(
    RemoteQueuedMessage("q1", "Then open a draft pull request.", queuedAt = T0 + 420_000),
  )
}

/** A small settings-screen stand-in, drawn so the gallery needs no binary asset. */
private fun screenshotDataUri(): String {
  val bitmap = Bitmap.createBitmap(360, 240, Bitmap.Config.ARGB_8888)
  val canvas = Canvas(bitmap)
  val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  paint.shader = LinearGradient(0f, 0f, 360f, 240f, 0xFF1C1C1E.toInt(), 0xFF3A3A4C.toInt(), Shader.TileMode.CLAMP)
  canvas.drawRect(0f, 0f, 360f, 240f, paint)
  paint.shader = null
  paint.color = 0xFF2C2C2E.toInt()
  for (row in 0 until 4) canvas.drawRoundRect(20f, 30f + row * 50f, 340f, 66f + row * 50f, 10f, 10f, paint)
  paint.color = 0xFFF5A623.toInt()
  canvas.drawCircle(310f, 48f + 50f, 9f, paint)
  val out = ByteArrayOutputStream()
  bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
  return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
}

