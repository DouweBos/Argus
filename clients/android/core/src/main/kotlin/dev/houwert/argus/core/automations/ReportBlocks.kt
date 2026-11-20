package dev.houwert.argus.core.automations

import dev.houwert.argus.kit.protocol.generated.ReportBlock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

// ArgusKit's hand-written `RemoteReportBlock`: the generated wire type is raw JSON.

enum class ReportTone { Critical, Info, Positive, Warning }

/** A table cell: the schema allows a string or a number in the same column. */
sealed interface ReportCell {
  val text: String

  data class Text(override val text: String) : ReportCell
  data class Number(val value: Double) : ReportCell {
    override val text: String get() = if (value == Math.rint(value) && !value.isInfinite()) value.toLong().toString() else value.toString()
  }
}

data class ReportStatItem(val label: String, val value: String, val delta: Double? = null)

data class ReportListItem(val text: String, val href: String? = null, val tone: ReportTone? = null)

/** The closed block union a run's report is built from; the computer validates them. */
sealed interface ReportBlockView {
  data class Heading(val text: String) : ReportBlockView
  data class Markdown(val text: String) : ReportBlockView
  data class Stats(val items: List<ReportStatItem>) : ReportBlockView
  data class Table(val columns: List<String>, val rows: List<List<ReportCell>>) : ReportBlockView
  data class ListItems(val items: List<ReportListItem>) : ReportBlockView
  data class Series(val kind: String, val labels: List<String>, val values: List<Double>, val label: String?) : ReportBlockView
  data class Proposals(val ids: List<String>) : ReportBlockView
  data class Sessions(val ids: List<String>) : ReportBlockView

  companion object {
    /** Null for a block this client doesn't know, so a newer computer's report still renders the rest. */
    fun parse(block: ReportBlock): ReportBlockView? {
      val o = block as? JsonObject ?: return null
      return when (o.str("type")) {
        "heading" -> o.str("text")?.let(::Heading)
        "markdown" -> o.str("text")?.let(::Markdown)
        "stats" -> Stats(o.objects("items").mapNotNull { item ->
          val label = item.str("label") ?: return@mapNotNull null
          ReportStatItem(label, item.str("value") ?: "", item.num("delta"))
        })
        "table" -> Table(
          o.strings("columns"),
          (o["rows"] as? JsonArray).orEmpty().map { row ->
            (row as? JsonArray).orEmpty().map { cell ->
              val p = cell as? JsonPrimitive
              if (p != null && !p.isString && p.doubleOrNull != null) ReportCell.Number(p.doubleOrNull!!) else ReportCell.Text(p?.contentOrNull ?: "")
            }
          },
        )
        "list" -> ListItems(o.objects("items").mapNotNull { item ->
          val text = item.str("text") ?: return@mapNotNull null
          ReportListItem(text, item.str("href"), item.str("tone")?.let(::tone))
        })
        "series" -> Series(
          o.str("kind") ?: "bar",
          o.strings("labels"),
          (o["values"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.doubleOrNull },
          o.str("label"),
        )
        "proposals" -> Proposals(o.strings("ids"))
        "sessions" -> Sessions(o.strings("ids"))
        else -> null
      }
    }

    fun parseAll(blocks: List<ReportBlock>): List<ReportBlockView> = blocks.mapNotNull(::parse)

    private fun tone(raw: String): ReportTone? = when (raw) {
      "critical" -> ReportTone.Critical
      "info" -> ReportTone.Info
      "positive" -> ReportTone.Positive
      "warning" -> ReportTone.Warning
      else -> null
    }

    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
    private fun JsonObject.num(key: String): Double? = (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
    private fun JsonObject.strings(key: String): List<String> =
      (this[key] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
    private fun JsonObject.objects(key: String): List<JsonObject> = (this[key] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }
    private fun JsonArray?.orEmpty(): List<JsonElement> = this ?: emptyList()
  }
}

/** Whole numbers without a decimal point; anything else to two places. */
fun formatReportNumber(value: Double): String =
  if (value == Math.rint(value) && !value.isInfinite()) value.toLong().toString() else String.format(java.util.Locale.ROOT, "%.2f", value)
