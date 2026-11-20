package dev.houwert.argus.core.automations

import dev.houwert.argus.kit.protocol.ProtocolJson
import kotlinx.serialization.json.JsonArray
import kotlin.test.Test
import kotlin.test.assertEquals

class ReportBlocksTest {
  private fun parse(json: String) = ReportBlockView.parseAll(ProtocolJson.json.parseToJsonElement(json) as JsonArray)

  @Test
  fun readsEveryBlockKindAndSkipsUnknownOnes() {
    val blocks = parse(
      """
      [
        {"type":"heading","text":"H"},
        {"type":"markdown","text":"**b**"},
        {"type":"stats","items":[{"label":"Open","value":"11","delta":-2}]},
        {"type":"table","columns":["a","b"],"rows":[["x",3],["y",2.5]]},
        {"type":"list","items":[{"text":"t","href":"https://x","tone":"critical"},{"text":"u"}]},
        {"type":"series","kind":"bar","labels":["Mon"],"values":[4]},
        {"type":"proposals","ids":["p1","p2"]},
        {"type":"sessions","ids":["s1"]},
        {"type":"hologram","text":"from a newer computer"}
      ]
      """,
    )
    assertEquals(8, blocks.size)
    assertEquals(ReportBlockView.Heading("H"), blocks[0])
    assertEquals(ReportBlockView.Stats(listOf(ReportStatItem("Open", "11", -2.0))), blocks[2])
    val table = blocks[3] as ReportBlockView.Table
    assertEquals(listOf("x", "3", "y", "2.5"), table.rows.flatten().map { it.text })
    assertEquals(ReportListItem("t", "https://x", ReportTone.Critical), (blocks[4] as ReportBlockView.ListItems).items[0])
    assertEquals(ReportBlockView.Series("bar", listOf("Mon"), listOf(4.0), null), blocks[5])
    assertEquals(ReportBlockView.Proposals(listOf("p1", "p2")), blocks[6])
  }

  @Test
  fun formatsWholeNumbersWithoutADecimalPoint() {
    assertEquals("4", formatReportNumber(4.0))
    assertEquals("-1", formatReportNumber(-1.0))
    assertEquals("2.50", formatReportNumber(2.5))
  }
}
