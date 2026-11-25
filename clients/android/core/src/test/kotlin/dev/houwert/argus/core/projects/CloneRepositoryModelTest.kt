package dev.houwert.argus.core.projects

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.core.support.settle
import dev.houwert.argus.kit.protocol.generated.CloneSource
import dev.houwert.argus.kit.protocol.generated.CloneStatus
import dev.houwert.argus.kit.protocol.generated.Methods
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Test

class CloneRepositoryModelTest {
  private fun job(status: String, phase: String = "receiving", percent: String = "42") =
    """{"id":"c1","url":"octo/tally","url_kind":"shorthand","path":"/dev/tally","status":"$status",""" +
      """"phase":"$phase","percent":$percent,"error":null,"started_at":1,"finished_at":null}"""

  private suspend fun TestScope.model(clones: String = """{"clones":[]}"""): Pair<CloneRepositoryModel, FakeBackend> {
    val host = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(Methods.ProjectsCloneDefaults, """{"parent_dir":"/dev","parents":["/dev","/work"],"gh_available":true}""")
    backend.reply(Methods.ProjectsClones, clones)
    backend.reply(Methods.ProjectsClonePreview, """{"url_kind":"shorthand","name":"tally","path":"/dev/tally","problem":null}""")
    backend.reply(Methods.ProjectsClone, """{"clone":${job("running")}}""")
    attach(host, backend)
    return CloneRepositoryModel(host).also { it.load() } to backend
  }

  @Test fun defaultsFillTheFolderAndOfferProjectParents() = runTest {
    val (model, _) = model()
    assertEquals("/dev", model.parentDir.value)
    assertEquals(listOf("/dev", "/work"), model.parentChoices())
  }

  @Test fun startsOnlyOnceThePreviewHasNoProblem() = runTest {
    val (model, backend) = model()
    model.url.value = "octo/tally"
    assertFalse(model.canStart)
    model.refreshPreview()
    assertTrue(model.canStart)
    assertTrue(model.start(CloneSource.android))
    assertEquals(CloneStatus.running, model.job()?.status)
    assertEquals(1, backend.count(Methods.ProjectsClone.name))
  }

  @Test fun followsARunningCloneOnReopen() = runTest {
    val (model, _) = model("""{"clones":[${job("running")}]}""")
    assertEquals("c1", model.cloneId.value)
  }

  @Test fun eventsMoveTheJobOn() = runTest {
    val (model, backend) = model("""{"clones":[${job("running")}]}""")
    backend.emit("projects.clone", payload = job("done", "checking_out", "100"))
    settle()
    assertEquals(CloneStatus.done, model.job()?.status)
  }

  @Test fun labelsPhaseAndPercent() = runTest {
    val (model, _) = model("""{"clones":[${job("running")}]}""")
    val job = model.job()!!
    assertEquals("Receiving objects 42%", CloneRepositoryModel.progressLabel(job))
    val fraction = CloneRepositoryModel.overallFraction(job)!!
    assertTrue(fraction > 0.3f && fraction < 0.5f)
  }
}
