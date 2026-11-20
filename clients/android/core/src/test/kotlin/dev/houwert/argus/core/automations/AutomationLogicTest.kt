package dev.houwert.argus.core.automations

import dev.houwert.argus.core.support.decode
import dev.houwert.argus.kit.protocol.ProtocolJson
import dev.houwert.argus.kit.protocol.generated.RemoteAutomation
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationDetail
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationDetailTriggerKind
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationTriggerKind
import dev.houwert.argus.kit.protocol.generated.RemoteClaudeAccount
import dev.houwert.argus.kit.protocol.generated.RemoteRunner
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
  private fun encode(detail: RemoteAutomationDetail): JsonObject = AutomationInput.encode(detail).jsonObject

  @Test
  fun inheritAndTheDefaultModelGoOutAsNull() {
    val json = encode(newAutomationDetail(name = "A", playbook = "p"))
    assertEquals(JsonNull, json["autonomy"])
    assertEquals(JsonNull, json["model"])
    assertEquals(JsonNull, json["runner"])
    assertEquals(JsonNull, json["claude_account_id"])
    assertEquals(JsonPrimitive("schedule"), json["trigger_kind"])
    assertNull(json["run_at"])
  }

  @Test
  fun aRunOnceTriggerSendsItsTime() {
    val json = encode(newAutomationDetail(name = "A", triggerKind = RemoteAutomationDetailTriggerKind.once, runAt = "2026-11-10T09:00", playbook = "p"))
    assertEquals(JsonPrimitive("once"), json["trigger_kind"])
    assertEquals(JsonPrimitive("2026-11-10T09:00"), json["run_at"])
    assertEquals(Instant.ofEpochSecond(1_794_301_200), OnceTime.date("2026-11-10T09:00", "UTC"))
    // A schedule keeps no run-once time, even one left over from switching kinds.
    assertNull(encode(newAutomationDetail(name = "A", runAt = "2026-11-10T09:00"))["run_at"])
  }

  @Test
  fun anUnknownTriggerKindStillDecodes() {
    val kinds = ProtocolJson.decode(ListSerializer(RemoteAutomationTriggerKind.serializer()), ProtocolJson.json.parseToJsonElement("""["once","webhook"]"""))
    assertEquals(RemoteAutomationTriggerKind.once, kinds[0])
    assertEquals("webhook", kinds[1].rawValue)
    val automation = decode(
      RemoteAutomation.serializer(),
      """{"id":"a","name":"n","description":"","enabled":true,"trigger_kind":"webhook","projects":[],"running":false}""",
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
