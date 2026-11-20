package dev.houwert.argus.core.backend

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

class ExplicitNullsTest {
  private fun parse(text: String) = Json.parseToJsonElement(text)

  @Test fun insertsMissingNestedNull() {
    val out = withNull(parse("""{"input":{"agent":{"runner":"codex"}}}"""), listOf("input", "agent", "model")) as JsonObject
    assertEquals(JsonNull, out["input"]!!.jsonObject["agent"]!!.jsonObject["model"])
    assertEquals("\"codex\"", out["input"]!!.jsonObject["agent"]!!.jsonObject["runner"].toString())
  }

  @Test fun keepsPresentValuesAndMissingParents() {
    val body = parse("""{"model":"opus"}""")
    assertEquals(body, withNull(body, listOf("model")))
    assertEquals(body, withNull(body, listOf("input", "agent")))
  }
}
