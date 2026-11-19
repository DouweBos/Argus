package dev.houwert.argus.kit.util

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** A call's input is never shown as JSON, so the flattening is what the user reads, even for unknown tools. */
class ToolInputTest {
  @Test fun flattensNestedObjectsAndArraysIntoReadablePaths() {
    val fields = ToolInput.fields(
      mapOf(
        "file_path" to str("/tmp/a.txt"),
        "edits" to JsonArray(listOf(JsonObject(mapOf("old_string" to str("a"), "new_string" to str("b"))))),
      ),
    )
    assertEquals(listOf("edits 1 · new_string", "edits 1 · old_string", "file_path"), fields.map { it.label })
    assertEquals(listOf("b", "a", "/tmp/a.txt"), fields.map { it.value })
  }

  @Test fun rendersScalarsAsTextNeverAsJsonLiterals() {
    val byLabel = ToolInput.fields(
      mapOf(
        "count" to JsonPrimitive(3),
        "ratio" to JsonPrimitive(1.5),
        "enabled" to JsonPrimitive(true),
        "missing" to JsonNull,
        "empty" to JsonArray(emptyList()),
      ),
    ).associate { it.label to it.value }
    assertEquals("3", byLabel["count"])
    assertEquals("1.5", byLabel["ratio"])
    assertEquals("true", byLabel["enabled"])
    // Nothing to descend into, and no braces to show for it.
    assertEquals("none", byLabel["missing"])
    assertEquals("none", byLabel["empty"])
  }

  @Test fun marksLongAndMultiLineValuesForTheirOwnBlock() {
    val byLabel = ToolInput.fields(
      mapOf("short" to str("ok"), "wrapped" to str("line one\nline two"), "long" to str("x".repeat(60))),
    ).associate { it.label to it.isLong }
    assertEquals(false, byLabel["short"])
    assertEquals(true, byLabel["wrapped"])
    assertEquals(true, byLabel["long"])
  }
}
