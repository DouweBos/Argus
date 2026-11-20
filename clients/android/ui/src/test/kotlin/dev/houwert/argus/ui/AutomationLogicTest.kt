package dev.houwert.argus.ui

import dev.houwert.argus.core.automations.newAutomationDetail
import dev.houwert.argus.kit.protocol.generated.RemoteAutomation
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationDetailTriggerKind
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRunStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationTriggerKind
import dev.houwert.argus.kit.protocol.generated.RemoteProject
import dev.houwert.argus.ui.automations.AutomationFieldsText
import dev.houwert.argus.ui.automations.AutomationRowLogic
import dev.houwert.argus.ui.automations.GuardrailText
import dev.houwert.argus.ui.automations.OnceWallClock
import dev.houwert.argus.ui.theme.Tone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class AutomationLogicTest {
  private fun automation(enabled: Boolean = true, running: Boolean = false) = RemoteAutomation(
    id = "a", name = "n", description = "", enabled = enabled, triggerKind = RemoteAutomationTriggerKind.schedule,
    projects = emptyList(), running = running,
  )

  @Test
  fun theDotShowsTheLatestRunsOutcome() {
    assertEquals(Tone.Danger, AutomationRowLogic.dotTone(automation(), RemoteAutomationRunStatus.failed))
    assertEquals(Tone.Success, AutomationRowLogic.dotTone(automation(enabled = false), RemoteAutomationRunStatus.succeeded))
    assertEquals(Tone.Warning, AutomationRowLogic.dotTone(automation(), RemoteAutomationRunStatus.skipped))
    assertEquals(Tone.Accent, AutomationRowLogic.dotTone(automation(running = true), RemoteAutomationRunStatus.failed))
  }

  @Test
  fun withoutRunsItSaysWhetherTheAutomationIsOn() {
    assertEquals(Tone.Success, AutomationRowLogic.dotTone(automation(), null))
    assertEquals(Tone.Muted, AutomationRowLogic.dotTone(automation(enabled = false), null))
    assertEquals("paused", AutomationRowLogic.state(automation(enabled = false)))
    assertEquals("running", AutomationRowLogic.state(automation(running = true)))
  }

  @Test
  fun switchingRunnerDropsTheModelAndACustomRunnerDropsThePin() {
    val draft = newAutomationDetail(claudeAccountId = "w").copy(runner = "claude-code", model = "opus")
    val custom = AutomationFieldsText.withRunner(draft, "custom:apex")
    assertNull(custom.model)
    assertNull(custom.claudeAccountId)
    val back = AutomationFieldsText.withRunner(draft, "")
    assertNull(back.runner)
    assertEquals("w", back.claudeAccountId)
    assertEquals(draft, AutomationFieldsText.withRunner(draft, "claude-code"))
  }

  @Test
  fun pickingOnceStartsOnTheNextWholeHour() {
    val once = AutomationFieldsText.withTriggerKind(newAutomationDetail(timezone = "UTC"), RemoteAutomationDetailTriggerKind.once)
    assertNotNull(OnceWallClock.parse(once.runAt))
    assertEquals(0, OnceWallClock.parse(once.runAt)!!.minute)
  }

  @Test
  fun projectOptionsKeepAPickedProjectTheComputerNoLongerLists() {
    val options = AutomationFieldsText.projectOptions(listOf(RemoteProject("/w/argus", "argus")), listOf("/w/argus", "/old/peacock"))
    assertEquals(listOf("argus", "peacock"), options.map { it.label })
    assertEquals("not open on this computer", options[1].hint)
  }

  @Test
  fun guardrailNumbersAcceptACommaAndFallBack() {
    assertEquals(0.75, GuardrailText.parse("0,75", 0.8), 0.0)
    assertEquals(0.8, GuardrailText.parse("-1", 0.8), 0.0)
    assertEquals(25.0, GuardrailText.parse("lots", 25.0), 0.0)
    assertEquals("20", GuardrailText.format(20.0))
    assertEquals(listOf("infra/**", "**/*.lock"), GuardrailText.denylist(" infra/** ,, **/*.lock "))
  }

  @Test
  fun theOnceWallClockRoundTrips() {
    assertEquals("2026-11-10T09:00", OnceWallClock.format(OnceWallClock.parse("2026-11-10T09:00")!!))
    assertNull(OnceWallClock.parse("tomorrow"))
  }
}
