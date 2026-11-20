package dev.houwert.argus.core.devices

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.core.support.settle
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.RemotePlatform
import kotlin.test.assertEquals
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Test

class DeviceInputTest {
  @Test fun aTapReachesTheHostDownFirstAndWaitingDragSamplesCollapse() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)
    backend.hold(Methods.DevicesTouch)

    store.deviceTouch("d", RemotePlatform.ios, 0.1, 0.1, 0)
    for (step in 1..5) store.deviceTouch("d", RemotePlatform.ios, 0.1 * step, 0.1, 1)
    store.deviceTouch("d", RemotePlatform.ios, 0.5, 0.1, 2)
    store.deviceKeyboard("d", RemotePlatform.ios, 4, 0, true)
    settle()
    backend.release(Methods.DevicesTouch)
    settle()

    val types = backend.calls(Methods.DevicesTouch.name).map { (it.params as JsonObject)["event_type"]!!.jsonPrimitive.int }
    assertEquals(listOf(0, 1, 2), types)
    assertEquals(Methods.DevicesKeyboard.name, backend.calls.last { it.name.startsWith("devices.") }.name)
  }
}
