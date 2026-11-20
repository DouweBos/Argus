package dev.houwert.argus.core.stores

import dev.houwert.argus.core.sessions.AgentStartDefaults
import dev.houwert.argus.core.git.BaseBranchChoice
import dev.houwert.argus.core.git.BaseBranchPicker
import dev.houwert.argus.core.sessions.ComposerStart
import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.core.support.bool
import dev.houwert.argus.core.support.settle
import dev.houwert.argus.core.support.string
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.RemoteImageAttachment
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import org.junit.Test

class StartAgentTest {
  private val agent = """{"agent_id":"a-new","session_id":"s-1","status":"idle","created_at":1}"""
  private val image = RemoteImageAttachment(data = "aGk=", mediaType = "image/png")

  private fun session(status: String) =
    """{"session":{"id":"s-2","kind":"worktree","branch":"fix","description":"","path":"/r/wt","repo_root":"/r","status":"$status"}}"""

  private fun TestScope.store(): Pair<HostStore, FakeBackend> {
    val backend = FakeBackend()
    backend.reply(Methods.AgentsSpawn, """{"agent":$agent}""")
    backend.reply(Methods.AgentsList, """{"agents":[$agent]}""")
    val store = HostStore(backgroundScope)
    attach(store, backend)
    return store to backend
  }

  @Test fun spawnsWithTheDefaultModeSetsEffortThenSendsTheImages() = runTest {
    val (store, backend) = store()
    var opened: Pair<String, String>? = null
    val id = store.startAgent("s-1", ComposerStart("fix it", "fix it", listOf(image), effort = "high"), AgentStartDefaults(mode = "plan", model = "opus")) { a, s -> opened = a to s }
    assertEquals("a-new", id)
    assertEquals("a-new" to "s-1", opened)
    assertEquals("plan", backend.params(Methods.AgentsSpawn)?.string("permission_mode"))
    assertEquals("opus", backend.params(Methods.AgentsSpawn)?.string("model"))
    assertEquals("high", backend.params(Methods.AgentsSetEffort)?.string("level"))
    assertEquals(1, (backend.params(Methods.AgentsSend)?.get("images") as JsonArray).size)
  }

  @Test fun aPickedRunnerGetsItsOwnDefaultModelAndEffort() = runTest {
    val (store, backend) = store()
    store.startAgent("s-1", ComposerStart("", "", runnerId = "gemini"), AgentStartDefaults(model = "opus", effort = "high"))
    assertNull(backend.params(Methods.AgentsSpawn)?.string("model"))
    assertEquals("gemini", backend.params(Methods.AgentsSpawn)?.string("runner_id"))
    assertEquals(0, backend.count(Methods.AgentsSetEffort))
  }

  @Test fun anEmptyRequestStartsTheAgentWithoutAMessage() = runTest {
    val (store, backend) = store()
    store.startAgent("s-1", ComposerStart("", ""), AgentStartDefaults())
    assertEquals(0, backend.count(Methods.AgentsSend))
  }

  @Test fun trustedIsDroppedOverTheGateway() = runTest {
    val (store, backend) = store()
    assertEquals("a-new", store.startAgent("s-1", "trusted", null))
    assertNull(backend.params(Methods.AgentsSpawn)?.string("permission_mode"))
  }

  @Test fun textAloneRidesTheNewWorktreesPrompt() = runTest {
    val (store, backend) = store()
    backend.reply(Methods.SessionsCreate, session("initializing"))
    val created = store.startInNewWorktree("/r", "main", request = ComposerStart("fix it", "fix it"), defaults = AgentStartDefaults(mode = "plan"))
    assertEquals("s-2", created?.id)
    val create = backend.params(Methods.SessionsCreate)
    assertEquals("fix it", create?.string("prompt"))
    assertEquals("main", create?.string("base_branch"))
    assertEquals("plan", create?.string("permission_mode"))
    assertEquals(0, backend.count(Methods.AgentsSpawn))
  }

  @Test fun imagesWaitForSetupThenStartTheAgentHere() = runTest {
    val (store, backend) = store()
    backend.reply(Methods.SessionsCreate, session("ready"))
    backend.reply(Methods.SessionsList, """{"sessions":[${session("ready").removePrefix("""{"session":""").removeSuffix("}")}]}""")
    var opened: String? = null
    store.startInNewWorktree("/r", null, "fix", ComposerStart("look", "look", listOf(image)), AgentStartDefaults()) { _, s -> opened = s }
    val create = backend.params(Methods.SessionsCreate)
    assertNull(create?.string("prompt"))
    assertEquals(true, create?.bool("use_existing_branch"))
    settle()
    assertEquals(1, backend.count(Methods.AgentsSend))
    assertEquals("s-2", opened)
  }

  @Test fun thePhonePreselectsABaseFromTheGatewaysRead() = runTest {
    val (store, backend) = store()
    backend.reply(
      Methods.ProjectsBaseBranches,
      """{"local":["feature","main"],"origin_refs":["origin/main","origin/develop"],"protected_branches":[],"default_base_branch":"develop"}""",
    )
    val picker = BaseBranchPicker()
    picker.load("/r", "main", store)
    assertEquals("origin/develop", picker.base)
    assertEquals(listOf("feature", "main", "origin/main", "origin/develop"), picker.options.value)
  }
}

class BaseBranchChoiceTest {
  @Test fun theConfiguredDefaultWins() =
    assertEquals("staging", BaseBranchChoice.preselected(listOf("main", "staging"), listOf("origin/main"), "staging", emptyList(), null))

  @Test fun theRemoteTipOverALocalCopyTheProjectRootHasCheckedOut() =
    assertEquals("origin/main", BaseBranchChoice.preselected(listOf("main", "feature"), listOf("origin/main"), null, emptyList(), "main"))

  @Test fun noBaseLikeBranchFallsBackToTheFirstLocalOne() {
    assertEquals("feature", BaseBranchChoice.preselected(listOf("feature"), emptyList(), null, emptyList(), null))
    assertNull(BaseBranchChoice.preselected(emptyList(), emptyList(), null, emptyList(), null))
  }

  @Test fun onlyBaseLikeRemoteRefsAreOffered() = assertEquals(
    listOf("main", "feature", "origin/main", "origin/release"),
    BaseBranchChoice.options(listOf("main", "feature"), listOf("origin/main", "origin/someone-else", "origin/release"), listOf("release")),
  )
}
