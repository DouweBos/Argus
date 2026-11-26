package dev.houwert.argus.core.files

import java.util.Base64
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import org.junit.Test

class NotebookTest {
  @Test fun cellsAndTheirSources() {
    val notebook = Notebook.parse(
      """
      {"metadata": {"kernelspec": {"language": "Python"}},
       "cells": [
        {"cell_type": "markdown", "source": ["# Title\n", "Some text"]},
        {"cell_type": "code", "execution_count": 3, "source": "print(1)", "outputs": []},
        {"cell_type": "raw", "source": "raw"}
       ]}
      """,
    )
    assertEquals("python", notebook.language)
    assertEquals(
      listOf(Notebook.Cell.Markdown("# Title\nSome text"), Notebook.Cell.Code("print(1)", 3, emptyList()), Notebook.Cell.Raw("raw")),
      notebook.cells,
    )
  }

  @Test fun savedOutputs() {
    val png = Base64.getEncoder().encodeToString(byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47))
    val notebook = Notebook.parse(
      """
      {"metadata": {"language_info": {"name": "julia"}},
       "cells": [{"cell_type": "code", "execution_count": null, "source": "x", "outputs": [
        {"output_type": "stream", "name": "stdout", "text": ["a\n", "b"]},
        {"output_type": "stream", "name": "stderr", "text": "warn"},
        {"output_type": "execute_result", "data": {"text/plain": "42", "text/html": "<b>42</b>"}},
        {"output_type": "display_data", "data": {"image/png": "$png\n", "text/plain": "<Figure>"}},
        {"output_type": "error", "ename": "ValueError", "evalue": "bad", "traceback": ["\u001b[31mValueError\u001b[0m: bad"]},
        {"output_type": "unknown"}
       ]}]}
      """,
    )
    assertEquals("julia", notebook.language)
    val cell = notebook.cells.single() as Notebook.Cell.Code
    assertEquals(null, cell.executionCount)
    assertEquals(
      listOf(
        Notebook.Output.Text("a\nb", false),
        Notebook.Output.Text("warn", true),
        Notebook.Output.Html("<b>42</b>", "42"),
        Notebook.Output.Image(byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47)),
        Notebook.Output.Error("ValueError", "bad", "ValueError: bad"),
      ),
      cell.outputs,
    )
  }

  @Test fun refusesWhatIsNotANotebook() {
    assertFailsWith<Notebook.ParseException> { Notebook.parse("nope") }
    assertFailsWith<Notebook.ParseException> { Notebook.parse("{}") }
  }
}
