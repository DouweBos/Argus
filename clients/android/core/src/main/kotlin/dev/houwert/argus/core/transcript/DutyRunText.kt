package dev.houwert.argus.core.transcript

import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteMessageDutyRun
import dev.houwert.argus.kit.protocol.generated.RemoteMessageDutyRunStatus

/** A teammate duty run handed to its conversation: shown as a divider, never as something the user said. */
val RemoteMessage.isDutyRun: Boolean get() = dutyRun != null

object DutyRunText {
  fun failed(run: RemoteMessageDutyRun): Boolean = run.status == RemoteMessageDutyRunStatus.failed

  fun label(run: RemoteMessageDutyRun): String = "${run.automationName} ${if (failed(run)) "failed" else "finished"}"
}
