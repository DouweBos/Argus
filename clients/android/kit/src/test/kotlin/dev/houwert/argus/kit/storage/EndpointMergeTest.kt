package dev.houwert.argus.kit.storage

import dev.houwert.argus.kit.storage.DeviceIdentity.Companion.inferEndpointKind
import dev.houwert.argus.kit.storage.DeviceIdentity.Companion.mergedEndpoints
import dev.houwert.argus.kit.storage.RemoteEndpoint.Kind
import kotlin.test.assertEquals
import org.junit.Test

class EndpointMergeTest {
  private val lan = RemoteEndpoint(Kind.Lan, "ws://192.168.1.20:47615", 0)
  private val tailscale = RemoteEndpoint(Kind.Tailscale, "wss://mac.tail.ts.net", 1)
  private val cloudflare = RemoteEndpoint(Kind.Cloudflare, "wss://a.trycloudflare.com", 2)

  @Test fun keepsAnAddressThatIsNotLiveRightNow() =
    assertEquals(listOf(lan, tailscale), mergedEndpoints(listOf(lan, tailscale), listOf(lan)))

  @Test fun replacesAnAddressThatMoved() {
    val newLan = RemoteEndpoint(Kind.Lan, "ws://10.0.0.5:47615", 0)
    assertEquals(listOf(newLan, tailscale), mergedEndpoints(listOf(lan, tailscale), listOf(newLan)))
  }

  @Test fun learnsNewAddresses() =
    assertEquals(listOf(lan, cloudflare), mergedEndpoints(listOf(lan), listOf(lan, cloudflare)))

  @Test fun keepsWhatItKnowsWhenNothingIsLive() =
    assertEquals(listOf(lan, tailscale), mergedEndpoints(listOf(lan, tailscale), emptyList()))

  @Test fun startsFromScratch() =
    assertEquals(listOf(lan, tailscale), mergedEndpoints(null, listOf(tailscale, lan)))
}

class EndpointKindTest {
  @Test fun tailnetAddressesAreTailscale() {
    assertEquals(Kind.Tailscale, inferEndpointKind("ws://100.101.102.103:47615"))
    assertEquals(Kind.Tailscale, inferEndpointKind("ws://100.64.0.1:47615"))
    assertEquals(Kind.Tailscale, inferEndpointKind("ws://100.127.255.254:1"))
    assertEquals(Kind.Tailscale, inferEndpointKind("wss://mac.tail1234.ts.net"))
  }

  @Test fun outsideTheTailnetRangeIsLan() {
    assertEquals(Kind.Lan, inferEndpointKind("ws://100.63.0.1:47615"))
    assertEquals(Kind.Lan, inferEndpointKind("ws://100.128.0.1:47615"))
    assertEquals(Kind.Lan, inferEndpointKind("ws://192.168.1.20:47615"))
    assertEquals(Kind.Lan, inferEndpointKind("ws://mac.local:47615"))
  }

  @Test fun tlsIsATunnel() {
    assertEquals(Kind.Cloudflare, inferEndpointKind("wss://argus-abc123.houwert.dev"))
    assertEquals(Kind.Cloudflare, inferEndpointKind("wss://a-b-c.trycloudflare.com"))
  }
}
