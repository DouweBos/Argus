package dev.houwert.argus.core.files

import dev.houwert.argus.kit.protocol.generated.CodeFileRange
import kotlinx.coroutines.runBlocking
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LargeFilePagerTest {
  /** Pages of [text] the way the host cuts them: on the last line break that fits. */
  private fun pager(text: String, pageBytes: Long): LargeFilePager {
    val bytes = text.toByteArray()
    return LargeFilePager(bytes.size.toLong(), pageBytes) { offset, length ->
      val start = offset.toInt()
      val stop = minOf(bytes.size, start + length.toInt())
      var cut = stop
      if (stop < bytes.size) {
        val newline = (stop - 1 downTo start).firstOrNull { bytes[it] == '\n'.code.toByte() }
        if (newline != null) cut = newline + 1
      }
      CodeFileRange(String(bytes, start, cut - start), offset, cut.toLong(), bytes.size.toLong(), false)
    }
  }

  @Test fun numbersLinesAcrossPages() = runBlocking {
    val pager = pager("one\ntwo\nthree\nfour\n", 9)
    pager.start()
    assertEquals(listOf("one", "two"), pager.state.value.page?.lines)
    assertTrue(pager.hasNext)
    assertFalse(pager.state.value.hasPrevious)
    pager.next()
    assertEquals(listOf("three"), pager.state.value.page?.lines)
    assertEquals(3L, pager.state.value.page?.firstLine)
    pager.next()
    assertEquals(4L, pager.state.value.page?.firstLine)
    assertFalse(pager.hasNext)
    assertEquals(1.0, pager.progress)
    pager.previous()
    pager.previous()
    assertEquals(1L, pager.state.value.page?.firstLine)
    assertFalse(pager.state.value.hasPrevious)
  }

  @Test fun dropsCarriageReturns() {
    assertEquals(listOf("a", "b"), LargeFilePager.page(CodeFileRange("a\r\nb\r\n", 0, 6, 6, false), 1).lines)
  }

  @Test fun binaryPagesShowNothing() = runBlocking {
    val pager = LargeFilePager(10) { offset, _ -> CodeFileRange("", offset, offset, 10, true) }
    pager.start()
    assertTrue(pager.state.value.binary)
    assertNull(pager.state.value.page)
  }
}
