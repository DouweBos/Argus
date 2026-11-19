package dev.houwert.argus.core.stores

import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.kit.protocol.generated.Methods
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import org.junit.Test

/** A start offers models before any agent has reported them. */
class LastKnownModelsTest {
  @Test fun aRunnersLastReportedModelsComeFromTheHostsRunnerList() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(
      Methods.AutomationsRunners,
      """{"runners":[{"id":"claude-code","display_name":"Claude Code","is_custom":false,"default_model":null,"models":[],"reported_models":[{"value":"haiku","displayName":"Haiku","description":"","supportedEffortLevels":["low","high"]}]},{"id":"custom:apex","display_name":"Apex","is_custom":true,"default_model":null,"models":[]}]}""",
    )
    attach(store, backend)
    store.loadRunners()

    assertEquals(listOf("haiku"), store.lastKnownModels(null).map { it.value })
    assertEquals(listOf("low", "high"), store.lastKnownModels(null).first().supportedEffortLevels?.map { it.toString() })
    assertTrue(store.lastKnownModels("custom:apex").isEmpty())
  }
}
