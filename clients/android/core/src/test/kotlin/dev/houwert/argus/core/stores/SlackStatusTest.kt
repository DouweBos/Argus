package dev.houwert.argus.core.stores

import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.core.support.decode
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.RemoteAutomation
import dev.houwert.argus.kit.protocol.generated.SlackChannelRef
import dev.houwert.argus.kit.protocol.generated.SlackConnectionState
import dev.houwert.argus.kit.protocol.generated.SlackStatus
import dev.houwert.argus.kit.protocol.generated.SlackTriggerMatch
import dev.houwert.argus.kit.util.Labels
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.coroutines.test.runTest
import org.junit.Test

class SlackStatusTest {
  private val connected = """{"configured":true,"state":"connected","error":null,"workspace":"Acme","bot_name":"Argus",
    "owner":{"user_id":"U1","name":"Ada Lovelace"},"claim_code":null,"default_project":"/Users/ada/Work/argus/",
    "mappings":[{"channel_id":"C1","channel_name":"deploys","repo_root":"/Users/ada/Work/infra"}],
    "allowed_users":[{"user_id":"U1","name":"Ada Lovelace"},{"user_id":"U2"}],"thread_count":3}"""

  private val off = """{"configured":false,"state":"off","mappings":[],"allowed_users":[],"thread_count":0}"""

  @Test fun loadsTheComputersSlack() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)
    backend.reply(Methods.SlackStatus, """{"status":$connected}""")
    store.loadSlackStatus()

    val status = store.slackWorkspaces.value!!.single()
    assertEquals(SlackConnectionState.connected, status.state)
    assertEquals("Ada Lovelace", status.owner?.name)
    assertEquals(listOf("infra"), status.mappings.map { SlackStatusText.projectName(it.repoRoot) })
    assertNull(status.allowedUsers[1].name)
  }

  @Test fun anOlderComputerHasNoSlack() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)
    backend.fail(Methods.SlackStatus)
    store.loadSlackStatus()
    assertNull(store.slackWorkspaces.value)
  }

  @Test fun listsEveryWorkspace() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)
    val other = connected.replace("\"Acme\"", "\"Globex\"")
    backend.reply(Methods.SlackStatus, """{"status":$connected,"workspaces":[$connected,$other]}""")
    store.loadSlackStatus()
    assertEquals(listOf("Acme", "Globex"), store.slackWorkspaces.value!!.map { it.workspace })

    backend.reply(Methods.SlackStatus, """{"status":$off}""")
    store.loadSlackStatus()
    assertEquals(emptyList(), store.slackWorkspaces.value)
  }

  @Test fun statusReadsAsTheMacWordsIt() {
    val status = decode(SlackStatus.serializer(), connected)
    assertEquals("Connected", SlackStatusText.state(status))
    assertEquals("Acme · Argus", SlackStatusText.workspace(status))
    assertEquals("Ada Lovelace", SlackStatusText.owner(status))
    assertEquals("#deploys", SlackStatusText.channel("deploys"))
    assertEquals("Everything else → argus", SlackStatusText.fallback(status))

    val empty = decode(SlackStatus.serializer(), off)
    assertEquals("Not connected", SlackStatusText.state(empty))
    assertNull(SlackStatusText.workspace(empty))
    assertEquals("Asks which project", SlackStatusText.fallback(empty))
    assertEquals("Error", SlackStatusText.state(empty.copy(configured = true, state = SlackConnectionState.error)))
  }

  @Test fun slackTriggersInWords() {
    val deploys = SlackChannelRef("C1", "deploys")
    assertEquals("Messages starting with “deploy failed” in #deploys", Labels.slackTriggerLabel(deploys, SlackTriggerMatch.prefix, "deploy failed"))
    assertEquals("Messages mentioning “rollback” in #deploys", Labels.slackTriggerLabel(deploys, SlackTriggerMatch.keyword, " rollback "))
    assertEquals("Every message in #deploys", Labels.slackTriggerLabel(deploys, SlackTriggerMatch.any, null))
    assertEquals("Every message", Labels.slackTriggerLabel(null, null, null))

    val automation = decode(
      RemoteAutomation.serializer(),
      """{"id":"a","name":"n","description":"","enabled":true,"trigger_kind":"slack","slack_channel":{"id":"C1","name":"deploys"},
        "projects":[],"running":false}""",
    )
    assertEquals("Slack messages in #deploys", Labels.triggerLabel(automation))
  }
}
