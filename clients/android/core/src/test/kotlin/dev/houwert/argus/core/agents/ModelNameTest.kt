package dev.houwert.argus.core.agents

import dev.houwert.argus.kit.protocol.generated.RemoteModelInfo
import kotlin.test.assertEquals
import kotlin.test.assertNull
import org.junit.Test

class ModelNameTest {
  @Test fun aClaudeModelIdReadsAsItsFamilyAndVersion() {
    assertEquals("Claude Opus 5.5", ModelName.pretty("claude-opus-5-5"))
    assertEquals("Claude Opus 4.7", ModelName.pretty("claude-opus-4-7[1m]"))
    assertEquals("Claude Sonnet 4.5", ModelName.pretty("claude-sonnet-4-5-20250929"))
    assertEquals("Claude Opus 5", ModelName.pretty("claude-opus-5"))
  }

  @Test fun anythingElseIsNotGuessedAt() {
    assertNull(ModelName.pretty("opus"))
    assertNull(ModelName.pretty("default"))
    assertNull(ModelName.pretty("claude-3-5-sonnet-20241022"))
    assertNull(ModelName.pretty("callstack/Apex"))
  }

  @Test fun anAliasShowsTheModelItResolvesToTheDefaultIncluded() {
    val models = listOf(
      RemoteModelInfo(value = "default", displayName = "Default (recommended)", description = "", resolvedModel = "claude-opus-5-5"),
      RemoteModelInfo(value = "sonnet", displayName = "Sonnet", description = ""),
    )
    assertEquals("Claude Opus 5.5", ModelName.label(null, models))
    assertEquals("Sonnet", ModelName.label("sonnet", models))
    assertEquals("Claude Haiku 4.5", ModelName.label("claude-haiku-4-5", models))
    assertEquals("custom", ModelName.label("custom", models))
    assertNull(ModelName.label(null, emptyList()))
  }
}
