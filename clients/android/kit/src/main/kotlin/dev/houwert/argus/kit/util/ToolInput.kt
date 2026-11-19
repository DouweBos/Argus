package dev.houwert.argus.kit.util

import kotlin.math.abs
import kotlin.math.floor
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/** One labelled value from a tool's input. */
data class ToolInputField(
  /** Human-readable path: `file_path`, `edits 1 · old_string`. */
  val label: String,
  val value: String,
  /** Worth its own block rather than a line: code, prose, anything wrapped. */
  val isLong: Boolean,
) {
  val id: String get() = label
}

/**
 * Tool inputs flattened into labelled values. Nothing is shown as raw JSON: nested objects and
 * arrays flatten into a path, so even an unknown tool reads as a list.
 */
object ToolInput {
  /** Past this a value gets its own block instead of sitting on the label's line. */
  private const val LONG_VALUE_CHARS = 48

  fun fields(input: Map<String, JsonElement>): List<ToolInputField> {
    val out = mutableListOf<ToolInputField>()
    for (key in input.keys.sorted()) append(key, input.getValue(key), out)
    return out
  }

  private fun append(label: String, value: JsonElement, out: MutableList<ToolInputField>) {
    when {
      value is JsonObject && value.isNotEmpty() ->
        for (key in value.keys.sorted()) append("$label · $key", value.getValue(key), out)
      value is JsonArray && value.isNotEmpty() ->
        value.forEachIndexed { index, item -> append("$label ${index + 1}", item, out) }
      else -> {
        val text = scalar(value)
        out.add(ToolInputField(label, text, text.length > LONG_VALUE_CHARS || text.contains('\n')))
      }
    }
  }

  /** A leaf, and the two empty containers that have nothing to descend into. */
  private fun scalar(value: JsonElement): String {
    if (value is JsonNull || value !is JsonPrimitive) return "none"
    if (value.isString) return value.content
    value.booleanOrNull?.let { return it.toString() }
    val number = value.doubleOrNull ?: return value.content
    return if (number == floor(number) && abs(number) < 1e15) number.toLong().toString() else number.toString()
  }
}
