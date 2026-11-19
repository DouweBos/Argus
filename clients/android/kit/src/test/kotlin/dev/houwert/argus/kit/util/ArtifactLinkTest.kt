package dev.houwert.argus.kit.util

import dev.houwert.argus.kit.protocol.generated.RemoteToolCallStatus
import dev.houwert.argus.kit.protocol.generated.RemoteToolResultBlock
import dev.houwert.argus.kit.protocol.generated.RemoteToolResultBlockText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

class ArtifactLinkTest {
  private fun call(
    input: Map<String, JsonElement>,
    result: String,
    status: RemoteToolCallStatus = RemoteToolCallStatus.done,
    isError: Boolean? = null,
  ) = toolCall(
    "t1", "Artifact", input,
    resultBlocks = listOf(RemoteToolResultBlock.Text(RemoteToolResultBlockText("text", result))),
    status = status, isError = isError,
  )

  @Test fun aPublishLandsOnTheLinkInItsResultNamedAfterItsFile() {
    val link = ArtifactLink.from(
      call(
        mapOf("file_path" to str("/tmp/work/launch-plan.html"), "icon" to str("rocket")),
        "Published launch-plan.html at https://claude.ai/code/artifact/0f6e2c1a-1b2c-4d5e-8f90-1234567890ab (version 1).",
      ),
    )
    assertEquals("https://claude.ai/code/artifact/0f6e2c1a-1b2c-4d5e-8f90-1234567890ab", link?.url)
    assertEquals("launch-plan", link?.title)
    assertEquals(ArtifactLink.Action.PUBLISH, link?.action)
  }

  @Test fun anOpenLandsOnItsLink() {
    val link = ArtifactLink.from(
      call(
        mapOf("action" to str("open"), "url" to str("https://claude.ai/artifact/abc123")),
        "Opened the Artifact at https://claude.ai/artifact/abc123 for the user. Nothing was published or changed.",
      ),
    )
    assertEquals("https://claude.ai/artifact/abc123", link?.url)
    assertEquals(ArtifactLink.Action.OPEN, link?.action)
  }

  @Test fun nothingToShowBeforeItFinishesWhenItFailedOrForOtherActions() {
    val published = "Published a.html at https://claude.ai/artifact/abc123"
    assertNull(ArtifactLink.from(call(emptyMap(), published, status = RemoteToolCallStatus.running)))
    assertNull(ArtifactLink.from(call(emptyMap(), published, isError = true)))
    assertNull(ArtifactLink.from(call(mapOf("action" to str("read")), published)))
    assertNull(ArtifactLink.from(call(mapOf("asset" to JsonPrimitive(true)), published)))
    assertNull(ArtifactLink.from(call(emptyMap(), "Published a.html at https://example.com/page")))
  }
}
