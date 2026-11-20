package dev.houwert.argus.kit.account

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

/** The phone seals its push key byte-for-byte like the TS fixture, so the host opens it. */
class AccountPushKeyTest {
  @Serializable data class Vector(
    val device_id: String, val host_id: String, val device_noise_priv: String, val device_noise_pub: String,
    val host_noise_priv: String, val host_noise_pub: String, val push_key: String, val nonce: String, val sealed: String,
  )

  private val v = AccountLogTest.load("push_key.json", Vector.serializer())
  private fun data(b64: String) = AccountCodec.fromB64(b64)!!

  @Test fun sealsExactlyLikeTheFixture() {
    val sealed = AccountPushKey.seal(data(v.push_key), data(v.device_noise_priv), data(v.host_noise_pub), v.device_id, v.host_id, data(v.nonce))
    assertEquals(v.sealed, sealed)
  }

  @Test fun opensOnlyForItsHost() {
    assertContentEquals(data(v.push_key), AccountPushKey.open(v.sealed, data(v.host_noise_priv), data(v.device_noise_pub), v.device_id, v.host_id))
    assertNull(AccountPushKey.open(v.sealed, data(v.host_noise_priv), data(v.device_noise_pub), v.device_id, "00000000-0000-4000-8000-000000000003"))
  }

  @Test fun registrationEncodesWireKeys() {
    val reg = AccountPushRegistration("d", "fcm", "t", "production", mapOf("h" to "s"))
    val json = accountJson.encodeToJsonElement(AccountPushRegistration.serializer(), reg) as JsonObject
    assertEquals("d", json["device_id"]!!.jsonPrimitive.content)
    assertEquals("s", (json["sealed_keys"] as JsonObject)["h"]!!.jsonPrimitive.content)
  }
}
