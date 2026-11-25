package dev.houwert.argus.core.transcript

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DutyRunTextTest {
  @Test fun aDutyRunMessageDecodesAndLabelsByStatus() {
    val message = decodeMessage(
      """{"id":"m","role":"user","text_blocks":["Review requested finished"],"tool_calls":[],
        |"duty_run":{"automation_id":"a","automation_name":"Review requested","run_id":"r","status":"succeeded"}}""".trimMargin(),
    )
    assertTrue(message.isDutyRun)
    val run = message.dutyRun!!
    assertEquals("r", run.runId)
    assertEquals("Review requested finished", DutyRunText.label(run))
    assertFalse(DutyRunText.failed(run))
    val failed = run.copy(status = dev.houwert.argus.kit.protocol.generated.RemoteMessageDutyRunStatus.failed)
    assertEquals("Review requested failed", DutyRunText.label(failed))
    assertTrue(DutyRunText.failed(failed))
    assertFalse(textMessage("x").isDutyRun)
  }
}
