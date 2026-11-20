package dev.houwert.argus.core.stores

import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.kit.protocol.generated.Methods
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Test

class WorktreeCleanupModelTest {
  private fun entry(id: String, bytes: Double?, blocked: String? = null): String {
    val guard = blocked?.let { ""","blocked_by":"$it"""" } ?: ""
    val size = bytes?.let { ""","bytes":$it""" } ?: ""
    return """{"session_id":"$id","repo_root":"/r","project_name":"r","branch":"b-$id","last_activity_at":1,"reason":"idle"$size$guard}"""
  }

  private fun preview(enabled: Boolean = true, landedDays: Int = 7) =
    """{"policy":{"enabled":$enabled,"landed_days":$landedDays,"idle_days":30,"max_gb":100},"entries":[""" +
      listOf(entry("a", 100.0), entry("b", null), entry("c", 50.0, "uncommitted")).joinToString(",") +
      """],"total_bytes":1000}"""

  private fun TestScope.model(backend: FakeBackend): WorktreeCleanupModel {
    val host = HostStore(backgroundScope)
    attach(host, backend)
    return WorktreeCleanupModel(host)
  }

  @Test fun splitsWhatWouldGoFromWhatAGuardKeeps() = runTest {
    val backend = FakeBackend()
    backend.reply(Methods.WorktreesCleanupPreview, preview())
    val model = model(backend)
    model.load()
    assertEquals(listOf("a", "b"), model.removable.map { it.sessionId })
    assertEquals(listOf("c"), model.kept.map { it.sessionId })
    assertEquals(100.0, model.reclaimableBytes)
    assertNull(model.error.value)
    assertFalse(model.loading.value)
  }

  @Test fun aRefusedPolicyRollsBack() = runTest {
    val backend = FakeBackend()
    backend.reply(Methods.WorktreesCleanupPreview, preview())
    val model = model(backend)
    model.load()
    val before = assertNotNull(model.policy)

    backend.fail(Methods.WorktreesSetCleanupPolicy)
    assertFalse(model.setPolicy(before.copy(enabled = false)))
    assertEquals(before, model.policy)
    assertNotNull(model.error.value)
  }

  @Test fun aSavedPolicyReloadsTheDryRun() = runTest {
    val backend = FakeBackend()
    backend.reply(Methods.WorktreesCleanupPreview, preview())
    val model = model(backend)
    model.load()
    backend.reply(Methods.WorktreesSetCleanupPolicy, """{"enabled":true,"landed_days":3,"idle_days":30,"max_gb":100}""")
    backend.reply(Methods.WorktreesCleanupPreview, preview(landedDays = 3))

    assertTrue(model.setPolicy(model.policy!!.copy(landedDays = 3)))
    assertEquals(3L, model.policy?.landedDays)
    assertEquals(JsonPrimitive(3), backend.params(Methods.WorktreesSetCleanupPolicy)?.get("landed_days"))
    assertEquals(2, backend.count(Methods.WorktreesCleanupPreview))
  }

  @Test fun cleaningUpReloadsAndReportsTheSweep() = runTest {
    val backend = FakeBackend()
    backend.reply(Methods.WorktreesCleanupPreview, preview())
    backend.reply(Methods.WorktreesCleanupRun, """{"at":1,"trigger":"manual","removed":[${entry("a", 100.0)}],"freed_bytes":100,"failed":0}""")
    val model = model(backend)

    val sweep = model.cleanUpNow()

    assertEquals(1, sweep?.removed?.size)
    assertFalse(model.cleaning.value)
    assertEquals(1, backend.count(Methods.WorktreesCleanupPreview))
  }
}
