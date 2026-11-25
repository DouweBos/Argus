package dev.houwert.argus.core.files

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.kit.protocol.generated.CodeFileRange
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * A file too large to open whole, read a page at a time from the host. Pages start on a line the
 * previous one ended on, so line numbers follow from counting line breaks.
 */
class LargeFilePager(
  val size: Long,
  private val pageBytes: Long = PAGE_BYTES,
  private val read: suspend (offset: Long, length: Long) -> CodeFileRange,
) {
  data class Page(val lines: List<String>, val firstLine: Long, val offset: Long, val end: Long, internal val breaks: Int)

  data class State(
    val page: Page? = null,
    val loading: Boolean = false,
    val failure: String? = null,
    /** The file holds NUL bytes: it isn't text, so there's nothing to page through. */
    val binary: Boolean = false,
    val hasPrevious: Boolean = false,
  )

  private val _state = MutableStateFlow(State())
  val state: StateFlow<State> = _state.asStateFlow()
  /** Where each page before this one started, for Previous. */
  private val back = ArrayDeque<Pair<Long, Long>>()

  val hasNext: Boolean get() = _state.value.page?.let { it.end < size } ?: false

  /** How far through the file this page ends, 0..1. */
  val progress: Double get() = if (size == 0L) 1.0 else ((_state.value.page?.end ?: 0L).toDouble() / size).coerceAtMost(1.0)

  suspend fun start() {
    back.clear()
    load(0, 1)
  }

  suspend fun next() {
    val page = _state.value.page ?: return
    if (!hasNext || _state.value.loading) return
    back.addLast(page.offset to page.firstLine)
    load(page.end, page.firstLine + page.breaks)
  }

  suspend fun previous() {
    if (back.isEmpty() || _state.value.loading) return
    val (offset, firstLine) = back.removeLast()
    load(offset, firstLine)
  }

  private suspend fun load(offset: Long, firstLine: Long) {
    _state.value = _state.value.copy(loading = true)
    _state.value = try {
      val range = read(offset, pageBytes)
      if (range.binary) {
        State(binary = true)
      } else {
        State(page = page(range, firstLine), hasPrevious = back.isNotEmpty())
      }
    } catch (e: Exception) {
      if (HostStore.isCancellation(e)) throw e
      _state.value.copy(loading = false, failure = HostStore.describe(e))
    }
  }

  companion object {
    const val PAGE_BYTES = 256L * 1024

    internal fun page(range: CodeFileRange, firstLine: Long): Page {
      val lines = range.text.split('\n').map { it.removeSuffix("\r") }.toMutableList()
      val breaks = lines.size - 1
      if (lines.size > 1 && lines.last().isEmpty()) lines.removeAt(lines.lastIndex)
      return Page(lines, firstLine, range.offset, range.end, breaks)
    }
  }
}
