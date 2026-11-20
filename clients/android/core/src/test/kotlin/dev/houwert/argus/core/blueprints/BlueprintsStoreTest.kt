package dev.houwert.argus.core.blueprints

import dev.houwert.argus.core.stores.BlueprintsStore
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.LoadPhase
import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.kit.protocol.generated.BlueprintStepKey
import dev.houwert.argus.kit.protocol.generated.Methods
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Test

class BlueprintsStoreTest {
  private companion object {
    const val MAC_APP = "bp-mac"
    const val RUNNING_RUN = "run-running"
    const val FAILED_RUN = "run-failed"
  }

  private fun blueprint(id: String, name: String, references: List<String> = emptyList(), copyFrom: String? = null): String {
    val refs = references.joinToString(",") { """{"path":"$it","note":""}""" }
    val copy = copyFrom?.let { "\"$it\"" } ?: "null"
    return """{"id":"$id","name":"$name","summary":"","parent_dir":"~/Work","references":[$refs],""" +
      """"scaffold":{"kind":"empty"},"github":{"enabled":true,"owner":"","visibility":"private"},""" +
      """"copy_project_settings_from":$copy,"instructions":"","agent":{},"created_at":1,"updated_at":1}"""
  }

  private fun run(id: String, blueprint: String, status: String, steps: String = "[]") =
    """{"id":"$id","blueprint_id":"$blueprint","project_name":"p-$id","repo_root":"/r/$id","status":"$status",""" +
      """"steps":$steps,"started_at":1}"""

  private val list = """{"blueprints":[""" + listOf(
    blueprint(MAC_APP, "Mac app", listOf("/Users/dev/Projects/Argus", "/Users/dev/Projects/Grove"), "/Users/dev/Projects/Argus"),
    blueprint("bp-web", "web app"),
    blueprint("bp-expo", "Expo app"),
  ).joinToString(",") + "]}"

  private val runs = """{"runs":[""" + listOf(
    run(RUNNING_RUN, MAC_APP, "running"),
    run(FAILED_RUN, MAC_APP, "failed", """[{"key":"validate","status":"failed","error":"exists"},{"key":"create_repo","status":"pending"}]"""),
    run("run-done", MAC_APP, "done"),
    run("run-web", "bp-web", "done"),
  ).joinToString(",") + "]}"

  private suspend fun TestScope.store(blueprints: String = list, history: String = runs): BlueprintsStore {
    val host = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(Methods.BlueprintsList, blueprints)
    backend.reply(Methods.BlueprintsRuns, history)
    attach(host, backend)
    return BlueprintsStore(host).also { it.refresh() }
  }

  @Test fun listsBlueprintsByNameAndRunsNewestFirst() = runTest {
    val store = store()
    assertEquals(listOf("Expo app", "Mac app", "web app"), store.blueprints.value.map { it.name })
    assertEquals(RUNNING_RUN, store.runs.value.first().id)
    assertEquals(3, store.runs(MAC_APP).size)
    assertEquals(BlueprintStepKey.validate, store.run(FAILED_RUN)?.failedStep?.key)
    assertEquals(LoadPhase.Content, store.phase)
  }

  @Test fun anEmptyListReadsAsEmptyNotAsAnError() = runTest {
    val store = store("""{"blueprints":[]}""", """{"runs":[]}""")
    assertTrue(store.blueprints.value.isEmpty())
    assertNull(store.error.value)
    assertEquals(LoadPhase.Empty, store.phase)
  }

  @Test fun aFormRoundTripsABlueprintAndClearsTheSettingsSourceWithAnEmptyString() = runTest {
    val store = store()
    val blueprint = assertNotNull(store.blueprint(MAC_APP))
    var form = BlueprintForm.from(blueprint)
    assertEquals(listOf("Argus", "Grove"), form.references.map { it.name })
    assertEquals("/Users/dev/Projects/Argus", form.copySettingsFrom)
    form = form.removingReference("/Users/dev/Projects/Argus")
    assertNull(form.copySettingsFrom)
    assertEquals("", form.updateInput.copyProjectSettingsFrom)
    assertNull(form.createInput.copyProjectSettingsFrom)
    assertNull(form.createInput.fromDraft)
  }

  @Test fun aTemplateBlueprintNeedsOwnerSlashName() {
    var form = BlueprintForm(name = "App", scaffold = BlueprintForm.ScaffoldKind.GithubTemplate, templateRepo = "template")
    assertNotNull(form.problem)
    form = form.copy(templateRepo = "me/template")
    assertNull(form.problem)
  }

  @Test fun projectNamesFollowTheHostsRule() {
    var request = BlueprintsStore.ProjectRequest()
    assertNotNull(request.nameProblem)
    request = request.copy(name = "my app")
    assertNotNull(request.nameProblem)
    request = request.copy(name = "tally-2")
    assertNull(request.nameProblem)
  }
}
