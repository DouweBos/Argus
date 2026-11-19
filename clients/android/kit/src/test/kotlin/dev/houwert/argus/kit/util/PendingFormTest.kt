package dev.houwert.argus.kit.util

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

/** Which form a pending call gets decides whether the card above may print the input, or the questions show twice. */
class PendingFormTest {
  @Test fun aQuestionPayloadOwnsItsInput() {
    val input = mapOf(
      "questions" to JsonArray(
        listOf(
          JsonObject(
            mapOf(
              "question" to str("Which database?"),
              "header" to str("Storage"),
              "options" to JsonArray(listOf(JsonObject(mapOf("label" to str("Postgres"))))),
            ),
          ),
        ),
      ),
    )
    val form = assertIs<PendingForm.Question>(PendingForm.of("AskUserQuestion", input))
    assertEquals(1, form.questions.size)
    assertTrue(form.ownsInput)
  }

  @Test fun aSecretRequestGetsTheSecureFormWhateverTheMcpPrefix() {
    val input = mapOf(
      "label" to str("Expo token"), "reason" to str("Build"),
      "delivery" to str("env"), "run_command" to str("Dev"), "env_var" to str("EXPO_TOKEN"),
    )
    val form = assertIs<PendingForm.Secret>(PendingForm.of("mcp__argus__request_secret", input))
    assertEquals("Expo token", form.request.label)
    assertEquals(SecretRequest.Delivery.Env("Dev", "EXPO_TOKEN"), form.request.delivery)
    assertTrue(PendingForm.of("request_secret", mapOf("label" to str("PIN"))).ownsInput)
    // A call with no label has nothing to show.
    assertEquals(PendingForm.Buttons, PendingForm.of("mcp__argus__request_secret", emptyMap()))
  }

  @Test fun aPlanOwnsItsInput() {
    val form = PendingForm.of("ExitPlanMode", mapOf("plan" to str("# Do the thing")))
    assertEquals(PendingForm.Plan("# Do the thing"), form)
    assertTrue(form.ownsInput)
  }

  @Test fun anythingElseFallsBackToAllowDenyWhichShowsNoInput() {
    assertFalse(PendingForm.of("Bash", mapOf("command" to str("ls"))).ownsInput)
    // A malformed payload has nothing to render, so it must not claim the input.
    assertFalse(PendingForm.of("AskUserQuestion", emptyMap()).ownsInput)
    assertFalse(PendingForm.of("ExitPlanMode", emptyMap()).ownsInput)
  }
}
