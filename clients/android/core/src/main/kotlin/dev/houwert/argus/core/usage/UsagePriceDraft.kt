package dev.houwert.argus.core.usage

import dev.houwert.argus.kit.protocol.generated.UsageListPrice
import dev.houwert.argus.kit.protocol.generated.UsagePriceOverride
import dev.houwert.argus.kit.protocol.generated.UsagePrices
import java.util.Locale

/**
 * The price editor's rows, as typed: hand-set prices first, then recently used list-priced
 * models with their list price as the placeholder. Immutable; edits return a new draft.
 */
class UsagePriceDraft private constructor(val rows: List<Row>, private val saved: List<Row>) {
  data class Row(
    val model: String,
    /** What the model costs without a hand-set price. */
    val list: ListRates?,
    val input: String = "",
    val output: String = "",
    val cacheRead: String = "",
    val cacheWrite: String = "",
    val mapTo: String = "",
    /** Marked "Reset to automatic"; undoable until saved. */
    val resetting: Boolean = false,
  ) {
    /** Anything typed: what makes the row an override. */
    val isSet: Boolean get() = !resetting && listOf(input, output, cacheRead, cacheWrite, mapTo).any { it.isNotBlank() }
    val isMapped: Boolean get() = mapTo.isNotBlank()
  }

  /** A list price per million tokens. */
  data class ListRates(val input: Double, val output: Double, val cacheRead: Double, val cacheWrite: Double) {
    constructor(price: UsageListPrice) : this(price.inputPerMtok, price.outputPerMtok, price.cacheReadPerMtok, price.cacheWritePerMtok)
  }

  class DraftError(override val message: String) : Exception(message)

  val isDirty: Boolean get() = rows != saved

  operator fun get(model: String): Row? = rows.firstOrNull { it.model == model }

  /** Replaces a row by its model; an unknown model changes nothing. */
  fun updating(model: String, change: (Row) -> Row): UsagePriceDraft =
    UsagePriceDraft(rows.map { if (it.model == model) change(it) else it }, saved)

  /** Adds a model by id at the top; null when it is blank or already listed. */
  fun adding(model: String): UsagePriceDraft? {
    val id = model.trim()
    if (id.isEmpty() || this[id] != null) return null
    return UsagePriceDraft(listOf(Row(id, null)) + rows, saved)
  }

  fun togglingReset(model: String): UsagePriceDraft = updating(model) { it.copy(resetting = !it.resetting) }

  /** The overrides to save, or why a field can't be read as a price. */
  fun overrides(): Result<List<UsagePriceOverride>> {
    val out = mutableListOf<UsagePriceOverride>()
    for (row in rows.filter { it.isSet }) {
      if (row.isMapped) {
        out += UsagePriceOverride(model = row.model, mapTo = row.mapTo.trim())
        continue
      }
      val prices = mutableListOf<Double?>()
      val fields = listOf("input" to row.input, "output" to row.output, "cache read" to row.cacheRead, "cache write" to row.cacheWrite)
      for ((field, value) in fields) {
        val raw = value.trim()
        if (raw.isEmpty()) {
          prices += null
          continue
        }
        val number = raw.replace("$", "").toDoubleOrNull()
        if (number == null || number < 0 || !number.isFinite()) {
          return Result.failure(DraftError("${row.model}: the $field price isn't a number."))
        }
        prices += number
      }
      out += UsagePriceOverride(row.model, prices[0], prices[1], prices[2], prices[3])
    }
    return Result.success(out)
  }

  override fun equals(other: Any?): Boolean = other is UsagePriceDraft && rows == other.rows && saved == other.saved

  override fun hashCode(): Int = rows.hashCode() * 31 + saved.hashCode()

  companion object {
    operator fun invoke(prices: UsagePrices, adding: String? = null): UsagePriceDraft {
      val lists = prices.list.groupBy { it.model }.mapValues { ListRates(it.value.first()) }
      val overrides = prices.overrides.map {
        Row(
          it.model, lists[it.model], text(it.inputPerMtok), text(it.outputPerMtok), text(it.cacheReadPerMtok),
          text(it.cacheWritePerMtok), it.mapTo ?: "",
        )
      }
      val known = overrides.map { it.model }.toSet()
      val rows = overrides + prices.list.filter { it.model !in known }.map { Row(it.model, ListRates(it)) }
      val draft = UsagePriceDraft(rows, rows)
      return adding?.let { draft.adding(it) } ?: draft
    }

    /** "3", "0.3", "15.75": what a price field shows for a stored rate. */
    fun text(value: Double?): String {
      value ?: return ""
      return String.format(Locale.US, "%.4f", value).trimEnd('0').trimEnd('.')
    }
  }
}
