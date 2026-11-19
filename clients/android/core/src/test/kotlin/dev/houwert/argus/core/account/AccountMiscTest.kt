package dev.houwert.argus.core.account

import dev.houwert.argus.core.support.FakeAccountAuth
import dev.houwert.argus.core.support.FakeAccountService
import dev.houwert.argus.kit.account.AccountCodec
import dev.houwert.argus.kit.account.AccountDeviceKeys
import dev.houwert.argus.kit.account.AccountDirectoryRecord
import dev.houwert.argus.kit.account.AccountEntryBuilder
import dev.houwert.argus.kit.account.AccountHead
import dev.houwert.argus.kit.account.AccountLog
import dev.houwert.argus.kit.account.AccountMember
import dev.houwert.argus.kit.account.AccountPresence
import dev.houwert.argus.kit.account.AccountProfile
import dev.houwert.argus.kit.account.AccountPushKey
import dev.houwert.argus.kit.account.AccountSignInProvider
import dev.houwert.argus.kit.account.AccountSigner
import dev.houwert.argus.kit.account.AccountVault
import dev.houwert.argus.kit.crypto.NoiseCrypto
import dev.houwert.argus.kit.crypto.NoiseKeypair
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

/** The device-name setting against the account. */
class AccountNameTest {
  private val service = FakeAccountService()
  private val auth = FakeAccountAuth()
  private var setting = "Studio"

  private fun kotlinx.coroutines.test.TestScope.store(vault: AccountVault = AccountVault.EMPTY) =
    makeStore(backgroundScope, service, auth, vault, kind = "mac", name = { setting }).first.also { it.onNameChanged = { n -> setting = n } }

  private fun renames() = service.log.map { Json.parseToJsonElement(it.body) as JsonObject }
    .filter { it["type"]!!.jsonPrimitive.content == "rename" }
    .map { it["member_id"]!!.jsonPrimitive.content to it["name"]!!.jsonPrimitive.content }

  @Test fun validation() {
    assertEquals("Studio", AccountDeviceKeys.validatedName("  Studio  "))
    assertNull(AccountDeviceKeys.validatedName("   "))
    assertNull(AccountDeviceKeys.validatedName("a".repeat(65)))
    assertNotNull(AccountDeviceKeys.validatedName("a".repeat(64)))
    assertNull(AccountDeviceKeys.validatedName("two\nlines"))
    assertNull(AccountDeviceKeys.validatedName("tab\there"))
  }

  @Test fun genesisUsesTheSetting() = runTest {
    val store = store()
    store.start()
    store.signIn(AccountSignInProvider.Apple)
    assertEquals("Studio", store.members.first().name)
  }

  @Test fun joinRequestCarriesTheCurrentSetting() = runTest {
    service.seed(listOf(service.genesis(TestKey(1))))
    setting = "Laptop"
    val store = store(AccountVault(keys = TestKey(5).deviceKeys))
    store.start()
    store.signIn(AccountSignInProvider.Apple)
    assertEquals("Laptop", service.join(service.joinIds.first())?.member?.name)
  }

  @Test fun settingRenamesThisDeviceAndWaitsWhileOffline() = runTest {
    val store = store()
    val events = store.recordEvents()
    store.start()
    store.signIn(AccountSignInProvider.Apple)
    service.appendDown = true
    assertTrue(store.setName("  Attic ", AccountStore.NameSource.Settings))
    assertEquals("Attic", setting)
    assertTrue(renames().isEmpty())
    assertEquals("Attic", store.vault.pendingName)
    service.appendDown = false
    store.refresh()
    assertEquals(listOf(store.memberId!! to "Attic"), renames())
    assertNull(store.vault.pendingName)
    assertTrue(AccountStore.Event.NameChanged(AccountStore.NameSource.Settings, true) in events)
    assertEquals(false, store.setName("\n", AccountStore.NameSource.Settings))
    assertEquals("Attic", setting)
  }

  @Test fun renameFromAnotherDeviceUpdatesTheSetting() = runTest {
    val store = store()
    store.start()
    store.signIn(AccountSignInProvider.Apple)
    val me = store.memberId!!
    val state = store.state.value!!
    val signer = AccountSigner(me, AccountCodec.fromB64(store.vault.keys!!.signSeed)!!)
    service.inject(AccountEntryBuilder.make(state.accountId, 0, state.head, signer = signer, fields = AccountEntryBuilder.Fields.Rename(me, "Kitchen")))
    store.refresh()
    assertEquals("Kitchen", setting)
  }

  @Test fun listRenameEditsTheSetting() = runTest {
    val store = store()
    store.start()
    store.signIn(AccountSignInProvider.Apple)
    val events = store.recordEvents()
    store.rename(store.memberId!!, "Desk")
    assertEquals("Desk", setting)
    assertEquals("Desk", store.members.first().name)
    assertEquals(listOf<AccountStore.Event>(AccountStore.Event.NameChanged(AccountStore.NameSource.AccountList, true)), events)
  }
}

class AccountPresenceTest {
  private val service = FakeAccountService()
  private val auth = FakeAccountAuth()
  private var now = 1_800_000_000_000L
  private val phone = TestKey(1)
  private val mini = TestKey(2)

  private suspend fun kotlinx.coroutines.test.TestScope.readyStore(): AccountStore {
    val g = service.genesis(phone, "Phone")
    val add = AccountEntryBuilder.make(service.accountId, 0, AccountHead(0, g.hash), signer = phone.signer, fields = AccountEntryBuilder.Fields.AddHost(mini.host("Mini"), "", "", mini.proof(mini.host("Mini"))))
    val state = AccountLog.verify(listOf(g, add)).state!!
    service.seed(listOf(g, add))
    auth.signedIn = true
    val store = makeStore(backgroundScope, service, auth, AccountVault(keys = phone.deviceKeys, root = state.root, entries = listOf(g, add)), now = { now }).first
    store.start()
    assertEquals(AccountStore.Phase.Ready, store.phase.value)
    return store
  }

  private fun seen(atMs: Long, ts: Int) {
    val body = """{"v":1,"account_id":"${service.accountId}","epoch":0,"host_id":"${mini.id}","ts":$ts,"endpoints":[{"kind":"cloudflare","url":"wss://mini.example","priority":2}]}"""
    service.setDirectory(listOf(AccountDirectoryRecord(mini.id, body, AccountCodec.sign(AccountCodec.presenceSigningBytes(body), mini.seed), atMs.toDouble())))
  }

  @Test fun hostComingOnlineShowsOnNextPoll() = runTest {
    val store = readyStore()
    assertEquals(false, store.host(mini.id)?.online)
    now += 120_000
    seen(now, 1)
    store.refreshDirectory()
    assertEquals(true, store.host(mini.id)?.online)
  }

  @Test fun heartbeatsKeepAHostOnline() = runTest {
    val store = readyStore()
    for (beat in 1..6) {
      now += 5 * 60_000
      seen(now, beat)
      store.refreshDirectory()
      assertEquals(true, store.host(mini.id)?.online)
    }
  }

  @Test fun onlineIsRecomputedWhenTheDirectoryIsDown() = runTest {
    val store = readyStore()
    seen(now, 1)
    store.refreshDirectory()
    assertEquals(true, store.host(mini.id)?.online)
    service.directoryDown = true
    now += AccountPresence.ONLINE_WINDOW_MS.toLong() + 1
    store.refreshDirectory()
    assertEquals(false, store.host(mini.id)?.online)
    assertEquals(listOf("wss://mini.example"), store.host(mini.id)?.endpoints?.map { it.url })
  }

  @Test fun windows() {
    val heartbeat = 5 * 60_000.0
    assertTrue(AccountPresence.ONLINE_WINDOW_MS >= 3 * heartbeat)
    assertTrue(AccountStore.PRESENCE_POLL_INTERVAL_MS < AccountPresence.ONLINE_WINDOW_MS / 2)
    val ms = 1_800_000_000_000.0
    assertTrue(AccountPresence.isOnline(ms - 2 * heartbeat, ms))
    assertTrue(AccountPresence.isOnline(ms - AccountPresence.ONLINE_WINDOW_MS, ms))
    assertTrue(!AccountPresence.isOnline(ms - AccountPresence.ONLINE_WINDOW_MS - 1, ms))
    assertTrue(!AccountPresence.isOnline(null, ms))
  }
}

class AccountPushTest {
  private val service = FakeAccountService()
  private val auth = FakeAccountAuth()
  private val keys = AccountDeviceKeys.generate("ios", "Phone")
  private val pushKey = ByteArray(32) { 7 }
  private val token = AccountPushToken(token = "fcm-token", environment = "production", pushKey = AccountCodec.b64(pushKey))

  private fun host(key: TestKey, noise: NoiseKeypair, name: String) =
    AccountMember(key.id, AccountMember.Role.Host, platform = "darwin", signPub = key.signPub, noisePub = AccountCodec.b64(noise.pub), name = name, createdAt = 1.0)

  private suspend fun kotlinx.coroutines.test.TestScope.readyStore(hostNoise: NoiseKeypair): Pair<AccountStore, AccountMember> {
    val signer = keys.signer!!
    service.append(AccountEntryBuilder.Fields.Genesis(keys.member), signer)
    val mini = TestKey(2)
    val member = host(mini, hostNoise, "Mini")
    service.append(AccountEntryBuilder.Fields.AddHost(member, "", "", mini.proof(member)), signer)
    val state = AccountLog.verify(service.log).state!!
    auth.signedIn = true
    val store = makeStore(backgroundScope, service, auth, AccountVault(keys = keys, root = state.root, entries = service.log.toList())).first
    store.start()
    assertEquals(AccountStore.Phase.Ready, store.phase.value)
    return store to member
  }

  @Test fun sealsPerHostAndResealsWhenAHostJoins() = runTest {
    val miniNoise = NoiseCrypto.generateKeypair()
    val (store, mini) = readyStore(miniNoise)
    val events = store.recordEvents()
    store.setPushToken(token)
    val first = service.pushRegistrations.first()
    assertEquals(keys.memberId, first["device_id"]!!.jsonPrimitive.content)
    assertEquals("fcm-token", first["token"]!!.jsonPrimitive.content)
    val sealed = (first["sealed_keys"] as JsonObject)[mini.id]!!.jsonPrimitive.content
    assertContentEquals(pushKey, AccountPushKey.open(sealed, miniNoise.priv, AccountCodec.fromB64(keys.noisePub)!!, keys.memberId, mini.id))
    assertEquals(listOf<AccountStore.Event>(AccountStore.Event.PushRegistered(true)), events)

    store.setPushToken(token)
    assertEquals(1, service.pushRegistrations.size)

    val studio = TestKey(3)
    val studioMember = host(studio, NoiseCrypto.generateKeypair(), "Studio")
    service.append(AccountEntryBuilder.Fields.AddHost(studioMember, "", "", studio.proof(studioMember)), keys.signer!!)
    store.refresh()
    runCurrent()
    assertEquals(2, service.pushRegistrations.size)
    assertEquals(setOf(mini.id, studio.id), (service.pushRegistrations.last()["sealed_keys"] as JsonObject).keys)

    store.setPushToken(null)
    assertEquals(listOf(keys.memberId), service.pushUnregistered)
  }

  @Test fun wakeAnnouncesEachJoinOnce() = runTest {
    val (store, _) = readyStore(NoiseCrypto.generateKeypair())
    val tablet = TestKey(5)
    val requestId = service.addJoin(tablet.device("Tablet"), tablet.proof(tablet.device("Tablet")))
    val woken = store.handleWake(emptySet(), token)
    assertTrue(woken.reached)
    assertEquals(listOf(requestId), woken.newRequests.map { it.requestId })
    assertEquals(1, service.pushRegistrations.size)
    assertTrue(store.handleWake(setOf(requestId)).newRequests.isEmpty())
  }

  @Test fun wakeAppliesThisDevicesRemoval() = runTest {
    val (store, _) = readyStore(NoiseCrypto.generateKeypair())
    val tablet = TestKey(5)
    val member = tablet.device("Tablet")
    service.append(AccountEntryBuilder.Fields.AddDevice(member, "", "", tablet.proof(member)), keys.signer!!)
    service.append(AccountEntryBuilder.Fields.Revoke(keys.memberId, "removed"), tablet.signer)
    assertTrue(store.handleWake(emptySet()).removed)
    assertEquals(AccountStore.Phase.SignedOut, store.phase.value)
  }
}

class AccountResetTest {
  private val service = FakeAccountService()
  private val auth = FakeAccountAuth()
  private val phone = TestKey(1)

  private suspend fun kotlinx.coroutines.test.TestScope.stranded(): Triple<AccountStore, dev.houwert.argus.kit.account.MemoryAccountVault, String> {
    service.seed(listOf(service.genesis(phone, "Phone")))
    val (store, memory) = makeStore(backgroundScope, service, auth, kind = "mac", name = { "Studio" })
    store.start()
    store.signIn(AccountSignInProvider.GitHub)
    assertEquals(AccountStore.Phase.AwaitingApproval, store.phase.value)
    return Triple(store, memory, service.joinIds.first())
  }

  @Test fun strandedDeviceResetsAfterACodeWithFreshKeys() = runTest {
    val (store, memory, requestId) = stranded()
    val joiningKeys = memory.vault.keys!!
    val events = store.recordEvents()
    assertTrue(store.canReset)
    store.beginReset()
    assertEquals(ResetFlow.AwaitingCode("me@example.test"), store.reset.value)
    store.confirmResetCode("000000")
    assertEquals(ResetFlow.AwaitingCode("me@example.test"), store.reset.value)
    assertNotNull(store.error.value)
    store.confirmResetCode("424242")
    assertEquals(AccountStore.Phase.Ready, store.phase.value)
    assertEquals(ResetFlow.Idle, store.reset.value)
    assertEquals(1, service.currentEpoch)
    val keys = memory.vault.keys!!
    assertNotEquals(joiningKeys.memberId, keys.memberId)
    assertNotEquals(joiningKeys.signPub, keys.signPub)
    assertEquals(listOf(keys.memberId), store.members.map { it.id })
    assertEquals(1, memory.vault.root?.epoch)
    assertEquals("denied", service.join(requestId)?.status)
    assertEquals(1, auth.sentReverifyCodes)
    assertEquals(listOf<AccountStore.Event>(AccountStore.Event.AccountReset(ResetAction.Started), AccountStore.Event.AccountReset(ResetAction.Completed)), events)
  }

  @Test fun reverifiedSessionResetsWithoutAnotherCode() = runTest {
    val (store, _, _) = stranded()
    auth.reverified = true
    store.beginReset()
    assertEquals(AccountStore.Phase.Ready, store.phase.value)
    assertEquals(0, auth.sentReverifyCodes)
    assertEquals(1, service.currentEpoch)
  }

  @Test fun serviceRefusalFallsBackToACode() = runTest {
    val (store, _, _) = stranded()
    store.beginReset()
    assertEquals(ResetFlow.AwaitingCode("me@example.test"), store.reset.value)
    assertEquals(0, service.currentEpoch)
  }

  @Test fun deviceOnTheOldEpochAsksToJoinAgain() = runTest {
    val (store, memory) = makeStore(backgroundScope, service, auth, kind = "mac", name = { "Studio" })
    store.start()
    store.signIn(AccountSignInProvider.GitHub)
    assertEquals(AccountStore.Phase.Ready, store.phase.value)
    val oldKeys = memory.vault.keys!!
    val events = store.recordEvents()
    service.resetElsewhere(service.genesis(phone, "Phone", epoch = 1))
    store.refresh()
    assertEquals(AccountStore.Phase.AwaitingApproval, store.phase.value)
    assertEquals(1, store.resetNotice.value?.epoch)
    assertEquals("Phone", store.resetNotice.value?.byName)
    assertNotNull(store.resetNotice.value?.atMs)
    assertTrue(store.hosts.value.isEmpty())
    assertNotEquals(oldKeys.memberId, memory.vault.keys!!.memberId)
    assertNull(memory.vault.root)
    assertEquals(1, service.joinIds.size)
    assertEquals(AccountStore.Event.AccountReset(ResetAction.Seen), events.first())
  }
}

class AccountProfileTest {
  @Test fun profileIsPublishedOnSignInAndDroppedOnSignOut() = runTest {
    val service = FakeAccountService()
    val auth = FakeAccountAuth().apply { user = AccountProfile(firstName = "Ada", lastName = "Lovelace", email = "ada@example.com") }
    val store = makeStore(backgroundScope, service, auth).first
    store.start()
    assertNull(store.profile.value)
    store.signIn(AccountSignInProvider.Apple)
    assertEquals("Ada Lovelace", store.profile.value?.displayName)
    assertEquals("ada@example.com", store.profile.value?.subtitle)
    store.signOut()
    assertNull(store.profile.value)
  }

  @Test fun profileOutlivesALapsedSession() = runTest {
    val service = FakeAccountService()
    val auth = FakeAccountAuth().apply { user = AccountProfile(firstName = "Ada", lastName = "Lovelace", email = "ada@example.com") }
    val (store, vault) = makeStore(backgroundScope, service, auth)
    store.start()
    store.signIn(AccountSignInProvider.Apple)
    auth.signedIn = false
    store.refresh()
    assertEquals("Ada Lovelace", store.profile.value?.displayName)
    val relaunched = AccountStore(backgroundScope, auth, vault, "ios", { "Phone" }, null, BASE_URL, service.http)
    relaunched.start()
    assertEquals(AccountStore.Phase.Ready, relaunched.phase.value)
    assertEquals("Ada Lovelace", relaunched.profile.value?.displayName)
  }

  @Test fun profileFallbacks() {
    val full = AccountProfile("Ada", "Lovelace", "ada", "ada@example.com")
    assertEquals("Ada Lovelace", full.displayName)
    assertEquals("AL", full.initials)
    assertEquals("ada@example.com", full.subtitle)
    val user = AccountProfile(firstName = " ", username = "ada", email = "ada@example.com")
    assertEquals("ada", user.displayName)
    assertEquals("A", user.initials)
    val mail = AccountProfile(email = "ada@example.com")
    assertEquals("ada@example.com", mail.displayName)
    assertNull(mail.subtitle)
    assertNull(AccountProfile().displayName)
    assertEquals("", AccountProfile().initials)
  }
}
