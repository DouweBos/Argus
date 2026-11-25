package dev.houwert.argus.core.stores

import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.core.support.bool
import dev.houwert.argus.core.support.decode
import dev.houwert.argus.core.support.string
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.net.TransportException
import dev.houwert.argus.kit.protocol.GatewayErrorPayload
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemoteToolCall
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import dev.houwert.argus.core.support.settle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Test

class HostStoreTest {
  private fun status(id: String, state: String) = """{"agent_id":"$id","session_id":"s1","status":"$state"}"""

  private val session = """{"id":"s1","repo_root":"/repo","kind":"worktree","branch":"main","status":"ready"}"""

  private fun gitStatus(branch: String = "main", ahead: Int = 0) =
    """{"status":{"branch":"$branch","upstream":"origin/$branch","ahead":$ahead,"behind":0,"dirty_count":0,"stash_count":0,"conflict_count":0,"detached":false}}"""

  @Test fun agentStatusUpdatesTheAgentEverywhereItIsListed() = runTest {
    val seen = mutableListOf<String>()
    val store = HostStore(backgroundScope, HostStoreHooks(agentsSeen = { seen += it }))
    val backend = FakeBackend()
    attach(store, backend)
    assertEquals(Transport.State.Ready, store.connection.value)

    backend.emit("agent.status", payload = status("a1", "running"))
    settle()
    assertEquals(RemoteAgentStatusStatus.running, store.statusByAgent.value["a1"]?.status)
    assertEquals(listOf("a1"), store.recentAgents.value.map { it.agentId })
    assertEquals(listOf("a1"), seen)

    backend.emit("agent.status", payload = status("a1", "idle"))
    settle()
    assertEquals(RemoteAgentStatusStatus.idle, store.statusByAgent.value["a1"]?.status)
    assertEquals(1, store.recentAgents.value.size)
  }

  @Test fun observersHearEventsUntilTheyStop() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)
    val seen = mutableListOf<String>()
    val stop = store.observeEvents { seen += "${it.event} ${it.seq}" }

    backend.emit("ipc", payload = """{"channel":"browser_view:nav","args":["s1"]}""")
    settle()
    assertEquals(listOf("ipc 1"), seen)

    stop()
    backend.emit("ipc", payload = """{"channel":"browser_view:nav","args":["s2"]}""")
    settle()
    assertEquals(1, seen.size)
  }

  @Test fun aPermissionRequestShowsUntilItIsCancelled() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)

    backend.emit("permission.request", payload = """{"agent_id":"a1","tool_use_id":"t1","tool_name":"Bash","tool_input":{}}""")
    settle()
    assertEquals("Bash", store.prompt("a1", "t1")?.toolName)

    backend.emit("permission.cancel", payload = """{"agent_id":"a1","tool_use_id":"t1"}""")
    settle()
    assertTrue(store.prompts.value.isEmpty())
  }

  @Test fun sessionsChangedRefetchesARepoTheStoreAlreadyHolds() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)
    backend.reply(Methods.SessionsList, """{"sessions":[]}""")
    store.loadSessions("/repo")
    assertEquals(emptyList(), store.sessionsByRepo.value["/repo"])

    backend.reply(Methods.SessionsList, """{"sessions":[$session]}""")
    backend.emit("sessions.changed", payload = """{"repo_root":"/repo"}""")
    settle()
    assertEquals(1, store.sessionsByRepo.value["/repo"]?.size)
    assertEquals("/repo", store.repoRoot("s1"))
  }

  @Test fun aBranchSwitchedOutsideArgusRereadsTheSessionsGitStatus() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)
    backend.reply(Methods.SessionsList, """{"sessions":[$session]}""")
    store.loadSessions("/repo")
    backend.reply(Methods.SessionsGitStatus, gitStatus("main", ahead = 0))
    store.loadGitStatus("s1")

    backend.reply(Methods.SessionsGitStatus, gitStatus("feature", ahead = 2))
    backend.reply(Methods.SessionsList, """{"sessions":[${session.replace("\"main\"", "\"feature\"")}]}""")
    backend.emit("sessions.changed", payload = """{"repo_root":"/repo"}""")
    settle()

    assertEquals("feature", store.gitStatusBySession.value["s1"]?.branch)
    assertEquals(2L, store.gitStatusBySession.value["s1"]?.ahead?.toLong())
    assertEquals("feature", store.sessionsByRepo.value["/repo"]?.first()?.branch)
  }

  @Test fun aBurstOfGitStatusRefreshesReadsOnceMoreAndOnlyWhatIsShown() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)
    backend.reply(Methods.SessionsGitStatus, gitStatus())
    store.loadGitStatus("s1")

    backend.hold(Methods.SessionsGitStatus)
    val first = launch { store.refreshGitStatus("s1") }
    // Let the first read reach the backend and park there.
    runCurrent()
    repeat(3) { store.refreshGitStatus("s1") }
    store.refreshGitStatus("s9")
    backend.release(Methods.SessionsGitStatus)
    first.join()

    assertEquals(3, backend.count(Methods.SessionsGitStatus))
  }

  @Test fun refreshingHeldListsRefetchesEveryRepoAlreadyListed() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)
    backend.reply(Methods.SessionsList, """{"sessions":[]}""")
    store.loadSessions("/repo")

    backend.reply(Methods.ProjectsList, """{"projects":[]}""")
    backend.reply(Methods.SessionsList, """{"sessions":[$session]}""")
    store.refreshHeldLists()
    assertEquals(1, store.sessionsByRepo.value["/repo"]?.size)
    assertTrue(store.projectsLoaded.value)
  }

  @Test fun sessionsChangedIgnoresARepoNobodyListed() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)
    backend.emit("sessions.changed", payload = """{"repo_root":"/elsewhere"}""")
    backend.emit("agent.status", payload = status("a1", "idle"))
    settle()
    assertNotNull(store.statusByAgent.value["a1"])
    assertEquals(0, backend.count(Methods.SessionsList))
  }

  @Test fun aSendTheHostRefusesLandsInFailedSends() = runTest {
    val events = mutableListOf<StoreEvent>()
    val scopes = mutableListOf<String>()
    val store = HostStore(backgroundScope, HostStoreHooks(track = { events += it }, errorReported = { _, scope -> scopes += scope }))
    val backend = FakeBackend()
    backend.fail(Methods.AgentsSend)
    attach(store, backend)

    store.sendMessage("a1", "hello")
    assertEquals(listOf("hello"), store.failedByAgent.value["a1"]?.map { it.text })
    assertNull(store.optimisticByAgent.value["a1"])
    assertNotNull(store.lastError.value)
    assertEquals(listOf("agent:send"), scopes)
    assertEquals(listOf<StoreEvent>(StoreEvent.MessageSendFailed(retried = false)), events)
  }

  @Test fun aRetryThatSucceedsLeavesTheFailedList() = runTest {
    val events = mutableListOf<StoreEvent>()
    val store = HostStore(backgroundScope, HostStoreHooks(track = { events += it }))
    store.sendMessage("a1", "offline")
    val failed = assertNotNull(store.failedByAgent.value["a1"]?.firstOrNull())

    val backend = FakeBackend()
    backend.reply(Methods.AgentsSend, """{"accepted":true,"queued":false}""")
    backend.reply(Methods.AgentsTranscript, """{"messages":[]}""")
    attach(store, backend)
    store.retryFailed("a1", failed.id)
    assertNull(store.failedByAgent.value["a1"])
    assertEquals(StoreEvent.MessageSent(queued = false, hasImages = false, length = 7), events.last())
  }

  @Test fun aSendTheHostQueuedShowsInTheQueueNotTheTranscript() = runTest {
    val events = mutableListOf<StoreEvent>()
    val store = HostStore(backgroundScope, HostStoreHooks(track = { events += it }))
    val backend = FakeBackend()
    backend.reply(Methods.AgentsSend, """{"accepted":true,"queued":true}""")
    backend.reply(Methods.AgentsQueueList, """{"messages":[{"id":"q1","text":"hello","queued_at":1}]}""")
    attach(store, backend)
    store.sendMessage("a1", "hello")
    assertEquals(listOf("q1"), store.queuedByAgent.value["a1"]?.map { it.id })
    assertTrue(store.optimisticByAgent.value["a1"].isNullOrEmpty())
    assertNull(store.failedByAgent.value["a1"])
    assertEquals(StoreEvent.MessageSent(queued = true, hasImages = false, length = 5), events.last())
  }

  @Test fun anUndeliverableAnswerIsHandedToTheApp() = runTest {
    val undelivered = mutableListOf<String>()
    val store = HostStore(backgroundScope, HostStoreHooks(decisionUndelivered = { agent, tool, decision -> undelivered += "$agent:$tool:$decision" }))
    store.respond("a1", "t1", "allow")
    assertEquals(listOf("a1:t1:allow"), undelivered)
    assertTrue(store.promptKey("a1", "t1") in store.answered.value)
  }

  @Test fun anAnswerTheHostRefusesBringsItsPromptBack() = runTest {
    val backend = FakeBackend()
    backend.fail(Methods.PermissionRespond)
    val store = HostStore(backgroundScope)
    attach(store, backend)
    store.respond("a1", "t1", "allow")
    assertFalse(store.promptKey("a1", "t1") in store.answered.value)
    assertTrue(store.lastError.value!!.startsWith("Your answer didn't reach the agent"))
    val gone = TransportException.Gateway(GatewayErrorPayload("bad_request", "no such outstanding prompt"))
    assertTrue(HostStore.refusedAnswerMessage(gone).startsWith("That prompt is no longer waiting"))
  }

  @Test fun aSecretGoesToSecretRespondAndNowhereElse() = runTest {
    val backend = FakeBackend()
    backend.reply(Methods.SecretRespond, """{"accepted":true}""")
    val store = HostStore(backgroundScope)
    attach(store, backend)
    store.respondSecret("a1", "t1", "4829")
    assertEquals("4829", backend.params(Methods.SecretRespond)?.string("value"))
    assertNull(backend.params(Methods.PermissionRespond))
    assertTrue(store.promptKey("a1", "t1") in store.answered.value)
  }

  @Test fun aRefusedSecretBringsItsCardBack() = runTest {
    val backend = FakeBackend()
    backend.fail(Methods.SecretRespond)
    val store = HostStore(backgroundScope)
    attach(store, backend)
    store.respondSecret("a1", "t1", null)
    assertFalse(store.promptKey("a1", "t1") in store.answered.value)
  }

  @Test fun anAnswerToAPromptTheHostNoLongerHoldsLeavesItSettled() = runTest {
    val backend = FakeBackend()
    backend.fail(Methods.PermissionRespond, TransportException.Gateway(GatewayErrorPayload("bad_request", "no such outstanding prompt")))
    val store = HostStore(backgroundScope)
    attach(store, backend)
    store.respond("a1", "t1", "deny", message = "Postgres")
    assertTrue(store.promptKey("a1", "t1") in store.answered.value)
    assertTrue(store.lastError.value!!.startsWith("That prompt is no longer waiting"))
  }

  private fun call(fields: String) = decode(RemoteToolCall.serializer(), """{"id":"q1","name":"AskUserQuestion","input":{},$fields}""")

  @Test fun aPromptTheHostSettledAsExpiredIsNotActionable() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)
    backend.emit("agent.status", payload = status("a1", "idle"))
    settle()
    assertEquals(RemoteAgentStatusStatus.idle, store.statusByAgent.value["a1"]?.status)

    // Restored history or a turn that moved on: the host sends it settled.
    val expired = call(""""status":"done","expired":true,"result_blocks":[{"type":"text","text":"Not answered"}]""")
    assertFalse(store.isToolCallPending("a1", expired))
  }

  @Test fun aPromptTheHostIsHoldingIsActionable() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)
    backend.emit("agent.status", payload = status("a1", "idle"))
    settle()

    val pending = call(""""result_blocks":[],"status":"pending","pending_permission":true""")
    assertTrue(store.isToolCallPending("a1", pending))
    val running = call(""""result_blocks":[],"status":"running"""")
    assertFalse(store.isToolCallPending("a1", running))
    backend.emit("permission.request", payload = """{"agent_id":"a1","tool_use_id":"q1","tool_name":"AskUserQuestion","tool_input":{}}""")
    settle()
    assertTrue(store.isToolCallPending("a1", running))
  }

  @Test fun alwaysAllowFromAPhoneAsksTheGatewayForTheRule() = runTest {
    val backend = FakeBackend(dev.houwert.argus.core.backend.HostBackendKind.Gateway)
    backend.reply(Methods.PermissionRespond, """{"accepted":true,"allow_rule":"Bash(npm *)"}""")
    val store = HostStore(backgroundScope)
    attach(store, backend)
    store.respond("a1", "t1", "allow", alwaysAllow = "Bash(npm *)")
    assertEquals(true, backend.params(Methods.PermissionRespond)?.bool("always_allow"))
    assertNull(store.lastError.value)

    backend.reply(Methods.PermissionRespond, """{"accepted":true}""")
    store.respond("a1", "t2", "allow", alwaysAllow = "Bash(npm *)")
    assertEquals(HostStore.ALWAYS_ALLOW_UNSUPPORTED, store.lastError.value)

    store.respond("a1", "t3", "allow")
    assertFalse(backend.params(Methods.PermissionRespond)!!.containsKey("always_allow"))
  }

  @Test fun aHostTooOldForAMethodIsNamedRatherThanReported() {
    assertEquals("usage.limits", HostStore.unsupportedMethod(TransportException.Unsupported("usage.limits", "0.68.0")))
    assertEquals(
      "This needs a newer version of Argus. The host you're connected to is running 0.68.0.",
      HostStore.describe(TransportException.Unsupported("usage.limits", "0.68.0")),
    )
    assertNull(HostStore.unsupportedMethod(TransportException.TimedOut()))
  }

  @Test fun aCancelledRequestNeverReachesTheUser() = runTest {
    val reported = mutableListOf<String>()
    val store = HostStore(backgroundScope, HostStoreHooks(errorReported = { _, scope -> reported += scope }))
    store.report(CancellationException("screen went away"))
    assertNull(store.lastError.value)
    assertTrue(reported.isEmpty())
    assertFalse(HostStore.isCancellation(TransportException.TimedOut()))
  }

  @Test fun resetForgetsThePreviousComputer() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)
    backend.emit("agent.status", payload = status("a1", "idle"))
    settle()
    assertTrue(store.recentAgents.value.isNotEmpty())

    store.detach()
    assertEquals(Transport.State.Offline, store.connection.value)
    assertNull(store.backend)
    store.reset()
    assertTrue(store.recentAgents.value.isEmpty())
    assertTrue(store.statusByAgent.value.isEmpty())
  }

  @Test fun connectionStateFollowsTheBackend() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)
    backend.emitState(Transport.State.Offline)
    settle()
    assertEquals(Transport.State.Offline, store.connection.value)
  }

  @Test fun anEmptyListReadsAsNotLoadedUntilTheComputerAnswers() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)
    store.refreshProjects()
    assertFalse(store.projectsLoaded.value)

    backend.reply(Methods.ProjectsList, """{"projects":[]}""")
    backend.reply(Methods.DevicesList, """{"devices":[]}""")
    store.refreshProjects()
    store.refreshDevices()
    assertTrue(store.projectsLoaded.value && store.projects.value.isEmpty())
    assertTrue(store.devicesLoaded.value)

    store.reset()
    assertFalse(store.projectsLoaded.value || store.devicesLoaded.value)
  }

  @Test fun aLaterConnectionClearsAConnectFailureInsteadOfSurfacingIt() = runTest {
    val store = HostStore(backgroundScope)
    store.beginConnecting()
    store.connectFailed("Couldn't reach this computer on any known address.")

    attach(store, FakeBackend())

    assertNull(store.lastError.value)
  }
}
