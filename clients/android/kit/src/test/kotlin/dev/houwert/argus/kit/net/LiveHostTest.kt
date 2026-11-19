package dev.houwert.argus.kit.net

import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assume.assumeTrue

/**
 * Pairs with and talks to a real headless host started with
 * `ARGUS_DEV_TRUST=1` (it auto-confirms loopback pairings). Skipped unless
 * `ARGUS_E2E_HOME` names that host's `ARGUS_HOME`.
 */
class LiveHostTest {
  @Test fun pairsConnectsAndLists() = runBlocking {
    val home = System.getenv("ARGUS_E2E_HOME")
    assumeTrue("set ARGUS_E2E_HOME to run", home != null)
    val file = Json.parseToJsonElement(File(home, "dev-pairing.json").readText()).jsonObject
    val payload = PairingClient.parse(file["payload"].toString())

    val events = PairingClient(payload, client = PairingClientInfo("Argus", "mobile", "JVM test")).start()
    val paired = withTimeout(15_000) { events.filterIsInstance<PairingClient.Event.Paired>().first() }
    assertTrue(paired.identity.capabilities.isNotEmpty())

    val attempt = withTimeout(15_000) { EndpointRacer.connectBest(paired.identity) }
    val transport = attempt.transport
    assertEquals(Transport.State.Ready, transport.state.value)
    val projects = transport.request(Methods.ProjectsList, MethodsTypes.ProjectsListParams())
    val agents = transport.request(Methods.AgentsList, MethodsTypes.AgentsListParams())
    println("projects=$projects agents=$agents")
    transport.disconnect()
    transport.close()
  }
}
