package dev.houwert.argus.kit.protocol

import dev.houwert.argus.kit.protocol.generated.Commands
import dev.houwert.argus.kit.protocol.generated.CommandsTypes
import dev.houwert.argus.kit.protocol.generated.HostDirectoryListing
import dev.houwert.argus.kit.protocol.generated.RemotePermissionMode
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlinx.serialization.json.JsonPrimitive

class EnvelopeTest {
  @Test fun decodesResponseAndError() {
    val ok = ProtocolJson.decodeFrame("""{"type":"res","seq":0,"id":"r0","ok":{"a":1}}""")
    assertIs<ServerFrame.Response>(ok)
    val err = ProtocolJson.decodeFrame("""{"type":"res","seq":1,"id":"r1","error":{"code":"capability_denied","message":"nope"}}""")
    assertIs<ServerFrame.Response>(err)
    assertEquals("capability_denied", err.envelope.error?.code)
    assertEquals("nope", err.envelope.error?.message)
  }

  @Test fun encodesParamsWithWireKeys() {
    val json = ProtocolJson.encode(Commands.ReadFile.params, CommandsTypes.ReadFileParams(id = "s1", relativePath = "a.txt"))
    assertEquals("""{"id":"s1","relativePath":"a.txt"}""", json.toString())
    assertEquals("read_file", Commands.ReadFile.name)
  }

  @Test fun decodesResultsAndKeepsUnknownEnumValues() {
    val listing = ProtocolJson.json.decodeFromString(
      HostDirectoryListing.serializer(),
      """{"entries":[{"is_repo":true,"name":"a","path":"/a"}],"home":"/","parent":null,"path":"/"}""",
    )
    assertEquals(true, listing.entries.first().isRepo)
    assertNull(listing.parent)
    val mode = ProtocolJson.decode(RemotePermissionMode.serializer(), JsonPrimitive("from_the_future"))
    assertEquals("from_the_future", mode.rawValue)
    assertEquals("plan", RemotePermissionMode.plan.rawValue)
  }
}

class RequestEnvelopeTest {
  @Test fun encodesTheTypeTag() {
    val text = ProtocolJson.json.encodeToString(RequestEnvelope.serializer(), RequestEnvelope(seq = 0, id = "r0", method = "m", params = JsonPrimitive(1)))
    assertEquals("""{"type":"req","seq":0,"id":"r0","method":"m","params":1}""", text)
    val sub = ProtocolJson.json.encodeToString(SubscribeEnvelope.serializer(), SubscribeEnvelope(seq = 1, action = "subscribe", agentId = "a"))
    assertEquals("""{"type":"sub","seq":1,"action":"subscribe","agent_id":"a"}""", sub)
  }
}

class ExplicitNullsTest {
  @Test fun requiredNullableFieldsGoOutAsNullAndOptionalOnesStayOff() {
    val info = dev.houwert.argus.kit.protocol.generated.AgentInfo(
      agentId = "a", createdAt = 1.0, runnerId = "r", sessionId = "s",
      status = dev.houwert.argus.kit.protocol.generated.AgentStatusValue("idle"),
    )
    val json = ProtocolJson.encode(dev.houwert.argus.kit.protocol.generated.AgentInfo.serializer(), info).toString()
    kotlin.test.assertTrue("\"model\":null" in json, json)
    kotlin.test.assertTrue("\"parent_agent_id\":null" in json, json)
    kotlin.test.assertTrue("pinned" !in json, json)
    kotlin.test.assertTrue("capabilities" !in json, json)
  }
}
