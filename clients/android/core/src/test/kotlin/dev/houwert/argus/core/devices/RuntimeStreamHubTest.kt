package dev.houwert.argus.core.devices

import dev.houwert.argus.core.backend.HostEvent
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.core.support.settle
import dev.houwert.argus.kit.crypto.ArgusBase64
import dev.houwert.argus.kit.media.MediaMessage
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.RemotePlatform
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlinx.coroutines.test.runTest
import org.junit.Test

class RuntimeStreamHubTest {
  // Stream 4097: a config and a key frame, as the host frames them.
  private val config = ArgusBase64.decode("AAABEAAAAAAAAAAAkgTkCQthdmMxLjY0MDAyOAFkACj/4QAFZ2QAKAEBAARo7jyw")!!
  private val keyFrame = ArgusBase64.decode("AQEBEK36XG1FSpNAAAAABWUBAgME")!!

  @Test fun sharesOneStreamReplaysToALateJoinerAndLetsGoWhenTheLastLeaves() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(Methods.DevicesWatch, """{"stream_id":4097}""")
    attach(store, backend)
    val hub = RuntimeStreamHub(store)
    val subject = RuntimeStreamHub.Subject.Device("d", RemotePlatform.ios)

    // The config lands before `devices.watch` returns and must still reach the view.
    backend.eventFlow.emit(HostEvent.Media(config))
    settle()
    val first = mutableListOf<MediaMessage>()
    val stopFirst = assertNotNull(hub.attach(subject, { first += it }))
    backend.eventFlow.emit(HostEvent.Media(keyFrame))
    settle()
    assertEquals(listOf("Config", "Frame"), first.map { it::class.simpleName })
    assertEquals(1, store.connectionBoundWork)

    val second = mutableListOf<MediaMessage>()
    val stopSecond = assertNotNull(hub.attach(subject, { second += it }))
    assertEquals(listOf("Config", "Frame"), second.map { it::class.simpleName })
    assertEquals(1, backend.count(Methods.DevicesWatch))

    stopFirst()
    settle()
    assertEquals(0, backend.count(Methods.DevicesUnwatch))
    stopSecond()
    settle()
    assertEquals(1, backend.count(Methods.DevicesRelease))
    assertEquals(1, backend.count(Methods.DevicesUnwatch))
    assertEquals(0, store.connectionBoundWork)
  }
}
