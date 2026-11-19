package dev.houwert.argus.kit.account

import dev.houwert.argus.kit.storage.DeviceIdentity
import dev.houwert.argus.kit.storage.RemoteEndpoint
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/**
 * The Kotlin verifier against the TS golden fixtures in `packages/remote-protocol/src/account/fixtures`:
 * every verifier must reject the same entry for the same reason, or a phone and a host disagree about who's trusted.
 */
class AccountLogTest {
  @Serializable data class Expect(val ok: Boolean, val head_seq: Int? = null, val live_members: List<String>? = null, val reason: String? = null, val index: Int? = null)
  @Serializable data class Admission(val member_id: String, val request_id: String, val sas_commit: String, val admitted: Boolean)
  @Serializable data class Presence(val record: AccountDirectoryRecord, val valid: Boolean)
  @Serializable data class Fixture(
    val name: String, val pin: AccountRoot? = null, val entries: List<AccountEntry>, val expect: Expect,
    val admission: Admission? = null, val presence: List<Presence>? = null,
  )
  @Serializable data class Key(val id: String, val sign_priv: String, val sign_pub: String, val noise_pub: String)
  @Serializable data class SasInput(
    val account_id: String, val epoch: Int, val head_hash: String, val approver_sign_pub: String,
    val subject_sign_pub: String, val subject_noise_pub: String, val request_id: String,
  )
  @Serializable data class SasVector(val input: SasInput, val sas: String, val commit: String)

  companion object {
    val json = Json { ignoreUnknownKeys = true }
    private val vectors = setOf("keys.json", "sas.json", "push_key.json", "request_signing.json")

    fun text(name: String): String = AccountLogTest::class.java.getResource("/$name")!!.readText()
    fun <T> load(name: String, serializer: KSerializer<T>): T = json.decodeFromString(serializer, text(name))
    fun keys(): Map<String, Key> = load("keys.json", MapSerializer(String.serializer(), Key.serializer()))

    val logFixtures: List<String> by lazy {
      val dir = File(AccountLogTest::class.java.getResource("/keys.json")!!.toURI()).parentFile
      dir.list()!!.filter { it.endsWith(".json") && it !in vectors && load(it, kotlinx.serialization.json.JsonElement.serializer()).let { e -> e is kotlinx.serialization.json.JsonObject && "entries" in e } }.sorted()
    }
  }

  @Test fun fixturesFound() = assertTrue(logFixtures.size >= 10)

  @Test fun matchesEveryFixturesVerdict() {
    for (file in logFixtures) {
      val fixture = load(file, Fixture.serializer())
      when (val result = AccountLog.verify(fixture.entries, root = fixture.pin)) {
        is AccountVerifyResult.Ok -> {
          assertTrue(fixture.expect.ok, "${fixture.name} verified but should fail")
          assertEquals(fixture.expect.head_seq, result.state.head.seq, fixture.name)
          assertEquals((fixture.expect.live_members ?: emptyList()).toSet(), result.state.liveMembers.map { it.id }.toSet(), fixture.name)
          fixture.admission?.let { a ->
            assertEquals(a.admitted, result.state.admits(a.member_id, a.request_id, a.sas_commit), fixture.name)
          }
          for (p in fixture.presence ?: emptyList()) {
            assertEquals(p.valid, AccountLog.verifyPresence(p.record, result.state) != null, "${fixture.name} presence")
          }
        }
        is AccountVerifyResult.Rejected -> {
          assertTrue(!fixture.expect.ok, "${fixture.name} failed with ${result.reason} at ${result.index}")
          assertEquals(fixture.expect.reason, result.reason.raw, fixture.name)
          assertEquals(fixture.expect.index, result.index, fixture.name)
        }
      }
    }
  }

  @Test fun emptyLogIsMalformed() {
    assertEquals(AccountVerifyResult.Rejected(AccountLogRejectReason.Malformed, 0, null), AccountLog.verify(emptyList()))
  }

  @Test fun priorAgainstOtherPinIsFork() {
    val fixture = load("valid_chain.json", Fixture.serializer())
    val state = AccountLog.verify(fixture.entries).state!!
    val other = AccountRoot(state.accountId, 0, "0".repeat(64))
    assertEquals(AccountVerifyResult.Rejected(AccountLogRejectReason.Fork, 0, null), AccountLog.verify(emptyList(), other, state))
  }

  @Test fun verifiesIncrementally() {
    val fixture = load("valid_chain.json", Fixture.serializer())
    val first = AccountLog.verify(fixture.entries.take(3)).state!!
    val rest = AccountLog.verify(fixture.entries.drop(3), first.root, first)
    assertEquals(7, (rest as AccountVerifyResult.Ok).state.head.seq)
  }

  @Test fun sasVectorMatchesTs() {
    for (v in load("sas.json", ListSerializer(SasVector.serializer()))) {
      val i = v.input
      val sas = AccountSas.compute(
        AccountSas.Input(i.account_id, i.epoch, i.head_hash, i.approver_sign_pub, i.subject_sign_pub, i.subject_noise_pub, i.request_id),
      )
      assertEquals(v.sas, sas.sas)
      assertEquals(v.commit, sas.commit)
    }
  }

  @Test fun ownEntriesVerifyAndTamperingBreaksThem() {
    val keys = keys()
    val phone = keys.getValue("phone")
    val mini = keys.getValue("mini")
    val phoneSigner = AccountSigner(phone.id, AccountCodec.fromB64(phone.sign_priv)!!)
    assertEquals(phone.sign_pub, AccountCodec.signingPublicKey(phoneSigner.seed))

    val device = AccountMember.device(phone.id, "ios", phone.sign_pub, phone.noise_pub, "Phone", 1_800_000_000_000.0)
    val genesis = AccountEntryBuilder.make("abcdefghijklmnopqrstuvwxyz", 0, null, signer = phoneSigner, fields = AccountEntryBuilder.Fields.Genesis(device))
    val host = AccountMember(mini.id, AccountMember.Role.Host, platform = "darwin", signPub = mini.sign_pub, noisePub = mini.noise_pub, name = "Mini", createdAt = 1_800_000_000_001.0)
    val proof = AccountEntryBuilder.proof(host, AccountCodec.fromB64(mini.sign_priv)!!)
    val addHost = AccountEntryBuilder.make(
      "abcdefghijklmnopqrstuvwxyz", 0, AccountHead(0, genesis.hash), signer = phoneSigner,
      fields = AccountEntryBuilder.Fields.AddHost(host, "req", "", proof),
    )
    val state = (AccountLog.verify(listOf(genesis, addHost)) as? AccountVerifyResult.Ok)?.state ?: fail("own entries didn't verify")
    assertEquals(listOf(phone.id, mini.id), state.liveMembers.map { it.id })
    assertTrue(state.admits(mini.id, "req", ""))
    assertEquals(14, state.root.safetyCode.length)
    assertTrue("\"created_at\":1800000000000," in genesis.body, genesis.body)

    val tampered = addHost.copy(body = addHost.body.replace("\"Mini\"", "\"Evil\""))
    val rejected = AccountLog.verify(listOf(genesis, tampered)) as AccountVerifyResult.Rejected
    assertEquals(AccountLogRejectReason.BadSignature, rejected.reason)
    assertEquals(1, rejected.index)
  }

  @Test fun linkCodesNormalizeLikeTheService() {
    assertEquals("WDJB-MJHT", AccountCodec.normalizeUserCode("wdjb mjht"))
    assertEquals("WDJB-MJHT", AccountCodec.normalizeUserCode("WDJB-MJHT"))
    assertEquals("WDJB-MJHT", AccountCodec.normalizeUserCode("wd-jb-mj-ht!"))
  }

  @Test fun oldPairingsDecodeAsPaired() {
    val identity = Json { ignoreUnknownKeys = true }.decodeFromString(
      DeviceIdentity.serializer(),
      """{"deviceId":"d","devPrivB64":"a","devPubB64":"b","desktopPubB64":"c","url":"ws://x","capabilities":[]}""",
    )
    assertEquals(DeviceIdentity.Source.Paired, identity.source)
    assertNull(identity.accountHostId)
  }

  @Test fun pairedAndAccountHostsMergeByKey() {
    val paired = DeviceIdentity("p", "", "", "K", "ws://lan", capabilities = listOf("control"))
    val account = DeviceIdentity(
      "account:h", "", "", "K", "", endpoints = listOf(RemoteEndpoint(RemoteEndpoint.Kind.Cloudflare, "wss://new", 2)),
      capabilities = emptyList(), source = DeviceIdentity.Source.Account, accountHostId = "h",
    )
    val other = DeviceIdentity("account:o", "", "", "O", "", capabilities = emptyList(), source = DeviceIdentity.Source.Account, accountHostId = "o")
    val merged = DeviceIdentity.merging(listOf(paired), listOf(account, other))
    assertEquals(listOf("p", "account:o"), merged.map { it.deviceId })
    assertEquals("h", merged[0].accountHostId)
    assertEquals(listOf("wss://new"), merged[0].endpoints?.map { it.url })
  }

  @Test fun memberNamesAreCleaned() {
    assertEquals("Device", AccountDeviceKeys.memberName("  \n "))
    assertEquals("Pixel", AccountDeviceKeys.memberName(" Pix\u0007el "))
    assertEquals(64, AccountDeviceKeys.memberName("x".repeat(80)).length)
    assertNull(AccountDeviceKeys.validatedName("a\nb"))
    assertEquals("Pixel 9", AccountDeviceKeys.validatedName("  Pixel 9 \n"))
  }
}
