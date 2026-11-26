package dev.houwert.argus.core.files

import java.util.Base64
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** A Jupyter notebook (`.ipynb`) as a reader sees it: its cells and the outputs saved with them. */
data class Notebook(
  /** The kernel's language, for highlighting code cells; `python` when the file doesn't say. */
  val language: String,
  val cells: List<Cell>,
) {
  sealed interface Cell {
    data class Markdown(val text: String) : Cell
    data class Code(val source: String, val executionCount: Int?, val outputs: List<Output>) : Cell
    data class Raw(val text: String) : Cell
  }

  sealed interface Output {
    /** `stream` text, or a result's `text/plain`; [isError] for stderr. */
    data class Text(val text: String, val isError: Boolean) : Output
    /** An exception: its name, message and traceback, terminal colours stripped. */
    data class Error(val name: String, val value: String, val traceback: String) : Output
    class Image(val bytes: ByteArray) : Output {
      override fun equals(other: Any?) = other is Image && bytes.contentEquals(other.bytes)
      override fun hashCode() = bytes.contentHashCode()
    }
    /** `text/html` with the `text/plain` beside it: viewers show the plain text when there is one, else the source. */
    data class Html(val html: String, val plain: String?) : Output
    data class Markdown(val text: String) : Output
  }

  class ParseException(message: String) : Exception(message)

  companion object {
    private val ansi = Regex("\u001B\\[[0-9;]*[A-Za-z]")

    fun stripAnsi(text: String) = ansi.replace(text, "")

    fun parse(json: String): Notebook {
      val root = runCatching { Json.parseToJsonElement(json) as? JsonObject }.getOrNull() ?: throw ParseException("Not JSON")
      val cells = root["cells"] as? JsonArray ?: throw ParseException("No cells")
      val metadata = root["metadata"] as? JsonObject
      val language = (metadata?.obj("language_info")?.str("name") ?: metadata?.obj("kernelspec")?.str("language") ?: "python").lowercase()
      return Notebook(language, cells.mapNotNull { (it as? JsonObject)?.let(::cell) })
    }

    private fun cell(raw: JsonObject): Cell {
      val source = text(raw["source"])
      return when (raw.str("cell_type")) {
        "markdown" -> Cell.Markdown(source)
        "code" -> Cell.Code(
          source,
          (raw["execution_count"] as? JsonPrimitive)?.intOrNull,
          (raw["outputs"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.let(::output) },
        )
        else -> Cell.Raw(source)
      }
    }

    private fun output(raw: JsonObject): Output? = when (raw.str("output_type")) {
      "stream" -> Output.Text(text(raw["text"]), raw.str("name") == "stderr")
      "error" -> Output.Error(
        raw.str("ename") ?: "Error",
        raw.str("evalue").orEmpty(),
        (raw["traceback"] as? JsonArray).orEmpty().joinToString("\n") { stripAnsi(it.jsonPrimitive.contentOrNull.orEmpty()) },
      )
      "execute_result", "display_data" -> {
        val bundle = raw.obj("data") ?: JsonObject(emptyMap())
        val image = listOf("image/png", "image/jpeg").firstNotNullOfOrNull { type ->
          bundle.str(type)?.let { runCatching { Base64.getMimeDecoder().decode(it.filterNot(Char::isWhitespace)) }.getOrNull() }
        }
        when {
          image != null -> Output.Image(image)
          "text/html" in bundle -> Output.Html(text(bundle["text/html"]), bundle["text/plain"]?.let(::text))
          "text/markdown" in bundle -> Output.Markdown(text(bundle["text/markdown"]))
          "text/plain" in bundle -> Output.Text(text(bundle["text/plain"]), false)
          else -> null
        }
      }
      else -> null
    }

    /** Notebook text is a string or a list of lines. */
    private fun text(value: JsonElement?): String = when (value) {
      is JsonPrimitive -> value.contentOrNull.orEmpty()
      is JsonArray -> value.joinToString("") { (it as? JsonPrimitive)?.contentOrNull.orEmpty() }
      else -> ""
    }

    private fun JsonObject.obj(key: String) = this[key] as? JsonObject
    private fun JsonObject.str(key: String) = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
  }
}
