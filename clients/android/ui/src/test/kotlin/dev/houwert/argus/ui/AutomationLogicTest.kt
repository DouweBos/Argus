package dev.houwert.argus.ui

import dev.houwert.argus.core.automations.newAutomationDetail
import dev.houwert.argus.kit.protocol.generated.RemoteAutomation
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationTriggerKind
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRunStatus
import dev.houwert.argus.kit.protocol.generated.RemoteProject
import dev.houwert.argus.kit.protocol.generated.RemoteSignalEventKind
import dev.houwert.argus.kit.protocol.generated.RemoteWebhookTriggerFire
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.automations.AutomationText
import dev.houwert.argus.ui.automations.EventTriggerText
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
    val once = AutomationFieldsText.withTriggerKind(newAutomationDetail(timezone = "UTC"), RemoteAutomationTriggerKind.once)
    assertNotNull(OnceWallClock.parse(once.runAt))
    assertEquals(0, OnceWallClock.parse(once.runAt)!!.minute)
  }

  @Test
  fun pickingSignalOrWebhookStartsOnTheDefaults() {
    val signal = AutomationFieldsText.withTriggerKind(newAutomationDetail(), RemoteAutomationTriggerKind.signal).signal!!
    assertEquals(listOf(RemoteSignalEventKind.newIssue), signal.on)
    assertEquals(4.0, signal.maxRunsPerHour, 0.0)
    val webhook = AutomationFieldsText.withTriggerKind(newAutomationDetail(), RemoteAutomationTriggerKind.webhook).webhook!!
    assertEquals(RemoteWebhookTriggerFire.each, webhook.fire)
    assertEquals(false, webhook.hasSecret)
  }

  @Test
  fun eventTriggerInputsKeepThePickerOrderAndClampTheCap() {
    assertEquals(listOf(RemoteSignalEventKind.newIssue, RemoteSignalEventKind.ciFailed), EventTriggerText.ordered(listOf("ci_failed", "x", "new_issue")))
    assertEquals(listOf("bug", "p1"), EventTriggerText.labels(" bug, ,p1 "))
    assertEquals(60.0, EventTriggerText.maxRuns("500"), 0.0)
    assertEquals(1.0, EventTriggerText.maxRuns("0"), 0.0)
    assertEquals(4.0, EventTriggerText.maxRuns("lots"), 0.0)
  }

  @Test
  fun eventTriggersReadAsEventsInTheList() {
    val signal = automation().copy(triggerKind = RemoteAutomationTriggerKind.signal)
    assertEquals("When an event arrives", AutomationText.nextRun(signal))
    assertEquals("When its webhook is called", AutomationText.nextRun(signal.copy(triggerKind = RemoteAutomationTriggerKind.webhook)))
    assertEquals("Paused", AutomationText.nextRun(signal.copy(enabled = false)))
    assertEquals("On events", Labels.triggerLabel(signal))
    assertEquals("On webhook", Labels.triggerLabel(signal.copy(triggerKind = RemoteAutomationTriggerKind.webhook)))
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
