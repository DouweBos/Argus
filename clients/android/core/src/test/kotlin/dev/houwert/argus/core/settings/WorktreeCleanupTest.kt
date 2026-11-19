package dev.houwert.argus.core.settings

import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupEntry
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupGuard
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupPolicy
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupReason
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlinx.coroutines.test.runTest
import org.junit.Test

class WorktreeCleanupTest {
  private val now = 1_700_000_000_000L
  private val day = 86_400_000.0

  private fun entry(reason: WorktreeCleanupReason, blocked: WorktreeCleanupGuard? = null, bytes: Double? = 2_500_000.0) =
    WorktreeCleanupEntry("s", "/r", "Argus", "feat", null, bytes, now - 3 * day, now - 2 * day, reason, blocked)

  @Test fun explainsWhyEachWorktreeGoesOrStays() {
    assertEquals("merged 2 days ago", WorktreeCleanupFormat.why(entry(WorktreeCleanupReason.landed), now))
    assertEquals("untouched since 3 days ago", WorktreeCleanupFormat.why(entry(WorktreeCleanupReason.idle), now))
    assertEquals("uncommitted changes", WorktreeCleanupFormat.why(entry(WorktreeCleanupReason.idle, WorktreeCleanupGuard.uncommitted), now))
  }

  @Test fun formatsSizes() {
    assertEquals("512 bytes", WorktreeCleanupFormat.bytes(512.0))
    assertEquals("2.5 MB", WorktreeCleanupFormat.bytes(2_500_000.0))
    assertEquals("120 GB", WorktreeCleanupFormat.bytes(120e9))
  }

  @Test fun keepsAnOffMenuValueSelectable() {
    assertEquals(listOf(1, 3, 5, 7), WorktreeCleanupModel.withCurrent(listOf(1, 3, 7), 5, 0))
    assertEquals(listOf(1, 3, 7), WorktreeCleanupModel.withCurrent(listOf(1, 3, 7), 0, 0))
  }

  @Test fun rollsBackAPolicyTheComputerRefused() = runTest {
    val backend = FakeBackend()
    backend.reply(
      Methods.WorktreesCleanupPreview,
      """{"policy":{"enabled":false,"landed_days":7,"idle_days":30,"max_gb":0},"entries":[],"total_bytes":0}""",
    )
    val model = WorktreeCleanupModel { backend }
    model.load()
    backend.fail(Methods.WorktreesSetCleanupPolicy)
    val ok = model.setPolicy(WorktreeCleanupPolicy(true, 7, 30, 0.0))
    assertEquals(false, ok)
    assertEquals(false, model.preview.value?.policy?.enabled)
    assertNotNull(model.error.value)
  }
}
