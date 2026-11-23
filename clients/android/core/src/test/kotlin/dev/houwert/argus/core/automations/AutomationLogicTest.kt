package dev.houwert.argus.core.automations

import dev.houwert.argus.core.support.decode
import dev.houwert.argus.core.backend.withNull
import dev.houwert.argus.kit.protocol.ProtocolJson
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.AutomationInput as GeneratedAutomationInput
import dev.houwert.argus.kit.protocol.generated.RemoteAutomation
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationDetail
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationTriggerKind
import dev.houwert.argus.kit.protocol.generated.RemoteClaudeAccount
import dev.houwert.argus.kit.protocol.generated.RemoteRunner
import dev.houwert.argus.kit.protocol.generated.RemoteSignalEventKind
import dev.houwert.argus.kit.protocol.generated.RemoteSignalTriggerFire
import dev.houwert.argus.kit.protocol.generated.RemoteWebhookTrigger
import dev.houwert.argus.kit.protocol.generated.RemoteWebhookTriggerFire
import dev.houwert.argus.kit.util.OnceTime
import java.time.Instant
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AutomationAccountPinTest {
  private fun account(id: String, label: String) = decode(
    RemoteClaudeAccount.serializer(),
    """{"id":"$id","label":"$label","needs_reauth":false,"rate_limited":false,"account_type":"claudeai"}""",
  )

  @Test
  fun onlyClaudeCodeTakesAPin() {
    assertTrue(AutomationAccountPin.appliesToRunner(null))
    assertTrue(AutomationAccountPin.appliesToRunner("claude-code"))
    assertFalse(AutomationAccountPin.appliesToRunner("custom:apex"))
  }

  @Test
  fun listsTheDefaultEveryAccountAndAPinToASignedOutOne() {
    val accounts = listOf(account("w", "Work"), account("h", "Home"))
    val options = AutomationAccountPin.options(accounts, activeId = "h", pinned = "gone")
    assertEquals(listOf("", "w", "h", "gone"), options.map { it.value })
    assertEquals("Follows the computer: Home", options.first().hint)
    assertTrue(AutomationAccountPin.offered(listOf(accounts[0]), pinned = "w"))
    assertFalse(AutomationAccountPin.offered(listOf(accounts[0]), pinned = null))
  }
}

class RunnerSetupFlowTest {
  private val setup = RunnerSetupFlow.Setup(installCommand = "npm install -g x", loginCommand = "x login")

  @Test
  fun startsOnInstallUntilTheCliIsFound() {
    var flow = RunnerSetupFlow("x", "X", setup, installed = false)
    assertEquals(RunnerSetupFlow.Step.Install, flow.step)
    assertEquals("npm install -g x", flow.command)
    assertEquals(RunnerSetupFlow.Next.Wait, flow.next)

    flow = flow.copy(phase = RunnerSetupFlow.Phase.Finished("t", 1))
    assertEquals(RunnerSetupFlow.Next.Retry, flow.next)
    flow = flow.copy(phase = RunnerSetupFlow.Phase.Finished("t", 0))
    assertEquals(RunnerSetupFlow.Next.CheckAgain, flow.next)
    flow = flow.copy(installed = true)
    assertEquals(RunnerSetupFlow.Next.SignIn, flow.next)

    flow = flow.copy(step = RunnerSetupFlow.Step.Login, phase = RunnerSetupFlow.Phase.Finished("t2", 130))
    assertEquals(RunnerSetupFlow.Next.Done, flow.next)
  }

  @Test
  fun anInstalledRunnerGoesStraightToSignIn() {
    val flow = RunnerSetupFlow("x", "X", setup, installed = true)
    assertEquals(RunnerSetupFlow.Step.Login, flow.step)
    assertEquals("x login", flow.command)
  }

  @Test
  fun aPageOnlyInstallWaitsToBeCheckedAgain() {
    var flow = RunnerSetupFlow("agy", "Antigravity", RunnerSetupFlow.Setup(installUrl = "https://example.com"), installed = false)
    flow = flow.copy(phase = RunnerSetupFlow.Phase.OpenedPage("https://example.com"))
    assertEquals(RunnerSetupFlow.Next.CheckAgain, flow.next)
    flow = flow.copy(installed = true)
    assertEquals(RunnerSetupFlow.Next.Done, flow.next)
  }

  @Test
  fun noFlowForARunnerArgusCantSetUp() {
    val runner = decode(RemoteRunner.serializer(), """{"id":"c","display_name":"C","is_custom":true,"models":[],"available":false}""")
    assertNull(RunnerSetupFlow.from(runner))
  }
}

class AutomationInputTest {
  private fun encode(detail: RemoteAutomationDetail): JsonObject =
    ProtocolJson.encode(GeneratedAutomationInput.serializer(), AutomationInput.create(detail)).jsonObject

  /** The patch as `automations.update` sends it, nulls included. */
  private fun patch(detail: RemoteAutomationDetail): JsonObject {
    val params = ProtocolJson.encode(MethodsTypes.AutomationsUpdateParams.serializer(), MethodsTypes.AutomationsUpdateParams("a", AutomationInput.patch(detail)))
    return AutomationInput.clearablePatchPaths.fold(params) { body, path -> withNull(body, path.split('.')) }.jsonObject["patch"]!!.jsonObject
  }

  @Test
  fun inheritAndTheDefaultModelGoOutAsNull() {
    val json = encode(newAutomationDetail(name = "A", playbook = "p"))
    // The host requires these two on create; runner and account are optional there.
    assertEquals(JsonNull, json["autonomy"])
    assertEquals(JsonNull, json["model"])
    assertEquals(JsonPrimitive("schedule"), json["trigger_kind"])
    assertNull(json["run_at"])
  }

  @Test
  fun aPatchClearsEveryInheritedPin() {
    val json = patch(newAutomationDetail(name = "A", playbook = "p"))
    for (key in listOf("autonomy", "model", "runner", "claude_account_id")) assertEquals(JsonNull, json[key], key)
    assertEquals(JsonPrimitive("A"), json["name"])
    assertEquals(JsonPrimitive("work"), patch(newAutomationDetail(name = "A", claudeAccountId = "work"))["claude_account_id"])
  }

  @Test
  fun aRunOnceTriggerSendsItsTime() {
    val json = encode(newAutomationDetail(name = "A", triggerKind = RemoteAutomationTriggerKind.once, runAt = "2026-11-10T09:00", playbook = "p"))
    assertEquals(JsonPrimitive("once"), json["trigger_kind"])
    assertEquals(JsonPrimitive("2026-11-10T09:00"), json["run_at"])
    assertEquals(Instant.ofEpochSecond(1_794_301_200), OnceTime.date("2026-11-10T09:00", "UTC"))
    // A schedule keeps no run-once time, even one left over from switching kinds.
    assertNull(encode(newAutomationDetail(name = "A", runAt = "2026-11-10T09:00"))["run_at"])
  }

  @Test
  fun aSignalTriggerSendsItsEventsAndNoWebhook() {
    val draft = newAutomationDetail(name = "A", triggerKind = RemoteAutomationTriggerKind.signal, playbook = "p").copy(
      signal = defaultSignalTrigger.copy(on = listOf(RemoteSignalEventKind.ciFailed), labels = listOf("bug"), fire = RemoteSignalTriggerFire.batch),
    )
    for (json in listOf(encode(draft), patch(draft))) {
      assertEquals(JsonPrimitive("signal"), json["trigger_kind"])
      val signal = json["signal"]!!.jsonObject
      assertEquals("""["ci_failed"]""", signal["on"].toString())
      assertEquals("""["bug"]""", signal["labels"].toString())
      assertEquals(JsonPrimitive("batch"), signal["fire"])
      assertNull(json["webhook"])
    }
    // A switch to signal without a config still sends the defaults.
    val bare = encode(newAutomationDetail(name = "A", triggerKind = RemoteAutomationTriggerKind.signal, playbook = "p"))
    assertEquals("""["new_issue"]""", bare["signal"]!!.jsonObject["on"].toString())
  }

  @Test
  fun aWebhookTriggerSendsOnlyWhatTheEditorOwns() {
    val draft = newAutomationDetail(name = "A", triggerKind = RemoteAutomationTriggerKind.webhook, playbook = "p").copy(
      webhook = RemoteWebhookTrigger(RemoteWebhookTriggerFire.batch, 6.0, url = "https://x/hooks/a", hasSecret = true),
    )
    for (json in listOf(encode(draft), patch(draft))) {
      val webhook = json["webhook"]!!.jsonObject
      assertEquals(setOf("fire", "max_runs_per_hour"), webhook.keys)
      assertEquals(JsonPrimitive("batch"), webhook["fire"])
      assertNull(json["signal"])
    }
    // A schedule leaves both out, even with configs left over from switching kinds.
    val schedule = encode(draft.copy(triggerKind = RemoteAutomationTriggerKind.schedule, signal = defaultSignalTrigger))
    assertNull(schedule["signal"])
    assertNull(schedule["webhook"])
  }

  @Test
  fun aSignalTriggerNeedsAnEvent() {
    val draft = newAutomationDetail(triggerKind = RemoteAutomationTriggerKind.signal, cron = null)
      .copy(signal = defaultSignalTrigger.copy(on = emptyList()))
    assertEquals("Pick at least one event to react to.", draft.signalError)
    assertFalse(draft.hasValidTrigger)
    assertTrue(draft.copy(signal = defaultSignalTrigger).hasValidTrigger)
    assertTrue(newAutomationDetail(triggerKind = RemoteAutomationTriggerKind.webhook, cron = null).hasValidTrigger)
  }

  @Test
  fun anUnknownTriggerKindStillDecodes() {
    val kinds = ProtocolJson.decode(ListSerializer(RemoteAutomationTriggerKind.serializer()), ProtocolJson.json.parseToJsonElement("""["once","cron"]"""))
    assertEquals(RemoteAutomationTriggerKind.once, kinds[0])
    assertEquals("cron", kinds[1].rawValue)
    val automation = decode(
      RemoteAutomation.serializer(),
      """{"id":"a","name":"n","description":"","enabled":true,"trigger_kind":"cron","projects":[],"running":false}""",
    )
    assertIs<RemoteAutomation>(automation)
  }

  @Test
  fun aComputerFromBeforeAccountPinsReadsAsUnpinnedAndAPinRoundTrips() {
    val old = ProtocolJson.json.encodeToJsonElement(RemoteAutomationDetail.serializer(), newAutomationDetail(name = "A", claudeAccountId = "x")).jsonObject
    val detail = ProtocolJson.decode(RemoteAutomationDetail.serializer(), JsonObject(old - "claude_account_id"))
    assertNull(detail.claudeAccountId)
    assertEquals(JsonPrimitive("work"), encode(newAutomationDetail(name = "A", claudeAccountId = "work"))["claude_account_id"])
  }
}
