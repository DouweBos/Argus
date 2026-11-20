package dev.houwert.argus.core.stores

import dev.houwert.argus.core.stores.IssueFilter.Field
import dev.houwert.argus.kit.protocol.generated.LinearIssue
import dev.houwert.argus.kit.protocol.generated.LinearWorkflowState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * An open "Add filter" menu: the fields, the values of the one opened, what's typed in each and
 * what's highlighted. Changes go straight to the filters through `apply`.
 */
class IssueFilterMenu(
  val issues: List<LinearIssue>,
  val states: List<LinearWorkflowState> = emptyList(),
  field: Field? = null,
  private val read: () -> List<IssueFilter>,
  private val apply: (List<IssueFilter>) -> Unit,
) {
  /** Opened from a filter chip: just that field's values, no field list. */
  val pinned: Field? = field

  /** The field whose values show; null while only the fields do. */
  private val _field = MutableStateFlow(field)
  val field: StateFlow<Field?> = _field.asStateFlow()
  private val _fieldQuery = MutableStateFlow("")
  val fieldQuery: StateFlow<String> = _fieldQuery.asStateFlow()
  private val _valueQuery = MutableStateFlow("")
  val valueQuery: StateFlow<String> = _valueQuery.asStateFlow()
  private val _highlightedField = MutableStateFlow<Field?>(null)
  val highlightedField: StateFlow<Field?> = _highlightedField.asStateFlow()
  private val _highlightedValue = MutableStateFlow<String?>(null)
  val highlightedValue: StateFlow<String?> = _highlightedValue.asStateFlow()
  /** The footer was tapped: options no issue matches show too. */
  private val _showsUnmatched = MutableStateFlow(false)
  val showsUnmatched: StateFlow<Boolean> = _showsUnmatched.asStateFlow()

  init {
    if (field != null && field.isText) _valueQuery.value = read().firstOrNull { it.field == field }?.values?.joinToString(" ") ?: ""
  }

  fun setFieldQuery(value: String) {
    if (value == _fieldQuery.value) return
    _fieldQuery.value = value
    _highlightedField.value = null
    // Searching the fields again means the open values are no longer the point.
    if (pinned == null) _field.value = null
  }

  fun setValueQuery(value: String) {
    if (value == _valueQuery.value) return
    _valueQuery.value = value
    _highlightedValue.value = null
  }

  fun highlightField(value: Field?) { _highlightedField.value = value }

  fun highlightValue(value: String?) { _highlightedValue.value = value }

  fun showUnmatched() { _showsUnmatched.value = true }

  private fun matches(text: String, query: String): Boolean {
    val trimmed = query.trim()
    return trimmed.isEmpty() || text.contains(trimmed, ignoreCase = true)
  }

  /** The fields matching what's typed, in the menu's groups. */
  val fieldGroups: List<List<Field>>
    get() = IssueFilters.groups.map { group -> group.filter { matches(it.label, _fieldQuery.value) } }.filter { it.isNotEmpty() }

  val picked: List<String>
    get() {
      val field = _field.value ?: return emptyList()
      return read().firstOrNull { it.field == field }?.values.orEmpty()
    }

  data class Split(val shown: List<IssueFilter.Option>, val unmatched: List<IssueFilter.Option>)

  /** The open field's options matching what's typed, split into ones some issue (or the filter) has and ones none does. */
  val options: Split
    get() {
      val field = _field.value
      if (field == null || field.isText) return Split(emptyList(), emptyList())
      val picked = picked.toSet()
      val all = IssueFilters.options(field, issues, states).filter { matches(it.label, _valueQuery.value) }
      val unmatched = all.filter { it.count == 0 && it.value !in picked }
      val shown = all.filter { it.count > 0 || it.value in picked }
      return if (_showsUnmatched.value) Split(shown + unmatched, emptyList()) else Split(shown, unmatched)
    }

  /** Keys work in the values once they're open, else in the fields. */
  val inValues: Boolean get() = _field.value != null

  fun open(next: Field?) {
    _field.value = next ?: pinned
    _valueQuery.value = ""
    _highlightedValue.value = null
    _showsUnmatched.value = false
  }

  fun move(step: Int) {
    if (inValues) {
      _highlightedValue.value = stepped(options.shown.map { it.value }, _highlightedValue.value, step)
    } else {
      _highlightedField.value = stepped(fieldGroups.flatten(), _highlightedField.value, step)
    }
  }

  private fun <T> stepped(rows: List<T>, current: T?, step: Int): T? {
    if (rows.isEmpty()) return null
    val at = if (current == null) -1 else rows.indexOf(current)
    if (at < 0) return if (step > 0) rows.first() else rows.last()
    return rows[(at + step + rows.size) % rows.size]
  }

  fun toggle(value: String) {
    val field = _field.value ?: return
    apply(IssueFilters.toggling(read(), field, value))
  }

  /** Return. True when the menu is done and should close. */
  fun submit(): Boolean {
    val field = _field.value
    if (field == null) {
      (_highlightedField.value ?: fieldGroups.flatten().firstOrNull())?.let { open(it) }
      return false
    }
    if (field.isText) {
      val text = _valueQuery.value.trim()
      apply(IssueFilters.updating(read(), field) { it.copy(values = if (text.isEmpty()) emptyList() else listOf(text)) })
      return true
    }
    val rows = options.shown
    val option = rows.firstOrNull { it.value == _highlightedValue.value } ?: rows.firstOrNull() ?: return false
    toggle(option.value)
    return true
  }

  /** Back to the fields when the values were opened from them. True when handled. */
  fun back(): Boolean {
    val field = _field.value
    if (field == null || pinned != null) return false
    _highlightedField.value = field
    _field.value = null
    return true
  }
}
