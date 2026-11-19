package dev.houwert.argus.kit.account

import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import okhttp3.HttpUrl.Companion.toHttpUrl

/** Member-signed requests against the TS vector (`request_signing.json`), and which routes go out on which key. */
class AccountClientAuthTest {
  @Serializable data class Case(val method: String, val path_and_query: String, val ts: Long, val body: String, val message: String, val sig: String)
  @Serializable data class Vector(val member_id: String, val sign_pub: String, val cases: List<Case>)

  private val phone: AccountSigner
    get() = AccountLogTest.keys().getValue("phone").let { AccountSigner(it.id, AccountCodec.fromB64(it.sign_priv)!!) }

  @Test fun signingBytesMatchTheTsVector() {
    val vector = AccountLogTest.load("request_signing.json", Vector.serializer())
    assertTrue(vector.cases.size >= 3)
    for (c in vector.cases) {
      val bytes = AccountCodec.requestSigningBytes(c.method, c.path_and_query, c.ts, c.body.encodeToByteArray())
      assertEquals(c.message, AccountCodec.b64(bytes))
      assertTrue(AccountCodec.verify(bytes, c.sig, vector.sign_pub))
    }
  }

  class Recorder {
    val requests = CopyOnWriteArrayList<AccountHttpRequest>()
    var respond: (AccountHttpRequest) -> Pair<Int, String> = { 200 to "{}" }
    val http: AccountHttp = { request ->
      requests += request
      val (status, body) = respond(request)
      AccountHttpResponse(status, body)
    }
  }

  private fun client(recorder: Recorder, token: String? = "clerk", signer: AccountSigner?, fallback: () -> Unit = {}) = AccountClient(
    "https://example.test/argus/account/v1".toHttpUrl(), token = { token }, signer = { signer }, http = recorder.http, onClerkFallback = fallback,
  )

  @Test fun liveMemberSignsWithItsKey() = runTest {
    val recorder = Recorder().apply { respond = { 201 to """{"head_seq":0}""" } }
    val signer = phone
    client(recorder, signer = signer).append(0, emptyList())
    val request = recorder.requests.first()
    assertNull(request.header("Authorization"))
    assertEquals(signer.id, request.header("x-argus-member"))
    val ts = request.header("x-argus-ts")!!.toLong()
    assertTrue(kotlin.math.abs(ts - System.currentTimeMillis()) < 60_000)
    val message = AccountCodec.requestSigningBytes("POST", "/argus/account/v1/log", ts, request.body!!)
    assertTrue(AccountCodec.verify(message, request.header("x-argus-sig")!!, AccountCodec.signingPublicKey(signer.seed)))
  }

  @Test fun queryIsSigned() = runTest {
    val recorder = Recorder().apply { respond = { 200 to """{"epoch":0,"entries":[],"next_after":null}""" } }
    val signer = phone
    client(recorder, signer = signer).log(0, -1)
    val request = recorder.requests.first()
    val ts = request.header("x-argus-ts")!!.toLong()
    val message = AccountCodec.requestSigningBytes("GET", "/argus/account/v1/log?epoch=0&after=-1", ts, ByteArray(0))
    assertTrue(AccountCodec.verify(message, request.header("x-argus-sig")!!, AccountCodec.signingPublicKey(signer.seed)))
  }

  @Test fun identityRoutesAlwaysGoOnClerk() = runTest {
    val recorder = Recorder().apply {
      respond = { r -> if (r.url.encodedPath.endsWith("/join")) 200 to """{"request_id":"r","expires_at":1}""" else 200 to """{"account_id":"a","epoch":0,"head_seq":0}""" }
    }
    val api = client(recorder, signer = phone)
    api.account()
    api.resetAccount(1, emptyList())
    api.join(AccountMember.device("d", "ios", "p", "n", "Phone", 1.0), "proof")
    assertEquals(3, recorder.requests.size)
    for (request in recorder.requests) {
      assertEquals("Bearer clerk", request.header("Authorization"))
      assertNull(request.header("x-argus-sig"))
    }
  }

  @Test fun noSignerUsesClerk() = runTest {
    val recorder = Recorder().apply { respond = { 200 to """{"hosts":[]}""" } }
    client(recorder, signer = null).directory()
    assertEquals("Bearer clerk", recorder.requests.first().header("Authorization"))
  }

  @Test fun oldServiceGetsOneClerkRetryThenClerkForTheLaunch() = runTest {
    val recorder = Recorder().apply {
      respond = { r -> if (r.header("x-argus-sig") != null) 403 to """{"error":"forbidden"}""" else 200 to """{"hosts":[]}""" }
    }
    val fallbacks = AtomicInteger()
    val api = client(recorder, signer = phone, fallback = { fallbacks.incrementAndGet() })
    api.directory()
    assertEquals(2, recorder.requests.size)
    assertEquals("Bearer clerk", recorder.requests[1].header("Authorization"))
    assertTrue(api.usesClerkForMembers)
    api.directory()
    assertEquals(3, recorder.requests.size)
    assertNull(recorder.requests[2].header("x-argus-sig"))
    assertEquals(1, fallbacks.get())
  }

  @Test fun refusedWithoutClerkSaysSo() = runTest {
    val recorder = Recorder().apply { respond = { 401 to """{"error":"unauthorized"}""" } }
    val api = client(recorder, token = null, signer = phone)
    assertEquals(AccountServiceError.MemberRefused(401), assertFailsWith<AccountServiceError.MemberRefused> { api.directory() })
    assertFalse(api.usesClerkForMembers)
  }

  @Test fun refusedWhileClockIsOffIsTheClock() = runTest {
    val api = AccountClient(
      "https://example.test/argus/account/v1".toHttpUrl(), token = { null }, signer = { phone },
      http = { AccountHttpResponse(401, """{"error":"unauthorized"}""", mapOf("Date" to "Sun, 06 Nov 1994 08:49:37 GMT")) },
    )
    assertFailsWith<AccountServiceError.ClockSkew> { api.directory() }
  }

  @Test fun accountResetCarriesEpochAndGenesis() = runTest {
    val recorder = Recorder().apply { respond = { 410 to """{"error":"account_reset","epoch":2,"genesis":{"body":"b","sigs":{"x":"y"}}}""" } }
    val error = assertFailsWith<AccountServiceError.AccountReset> { client(recorder, signer = phone).log(1, 0) }
    assertEquals(AccountServiceError.AccountReset(2, AccountEntry("b", mapOf("x" to "y"))), error)
  }

  @Test fun joinRequestsSkipUnreadableSubjects() = runTest {
    val recorder = Recorder().apply {
      respond = { 200 to """{"requests":[{"request_id":"a","subject":{"host":7}},{"request_id":"b","kind":"device","created_at":5}]}""" }
    }
    val requests = client(recorder, signer = phone).joinRequests()
    assertEquals(listOf("a", "b"), requests.map { it.requestId })
    assertNull(requests[0].subject)
    assertEquals("claimed", requests[1].status)
  }

}
