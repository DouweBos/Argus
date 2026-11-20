package dev.houwert.argus.core.account

import dev.houwert.argus.core.support.FakeAccountAuth
import dev.houwert.argus.core.support.FakeAccountService
import dev.houwert.argus.kit.account.AccountCodec
import dev.houwert.argus.kit.account.AccountDirectoryRecord
import dev.houwert.argus.kit.account.AccountEntryBuilder
import dev.houwert.argus.kit.account.AccountHead
import dev.houwert.argus.kit.account.AccountLinkSubject
import dev.houwert.argus.kit.account.AccountLog
import dev.houwert.argus.kit.account.AccountMember
import dev.houwert.argus.kit.account.AccountRoot
import dev.houwert.argus.kit.account.AccountSas
import dev.houwert.argus.kit.account.AccountSignInProvider
import dev.houwert.argus.kit.account.AccountSigner
import dev.houwert.argus.kit.account.AccountVault
import dev.houwert.argus.kit.net.TransportException
import dev.houwert.argus.kit.storage.DeviceIdentity
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

class AccountStoreTest {
  private val service = FakeAccountService()
  private val auth = FakeAccountAuth()

  private fun TestScope.store(vault: AccountVault = AccountVault.EMPTY, localHost: AccountLocalHostLinking? = null) =
    makeStore(backgroundScope, service, auth, vault, localHost = localHost)

  @Test fun firstSignInWritesGenesisAndPinsIt() = runTest {
    val (store, memory) = store()
    val events = store.recordEvents()
    store.start()
    assertEquals(AccountStore.Phase.SignedOut, store.phase.value)
    assertEquals("pk_test", auth.configuredKey)

    store.signIn(AccountSignInProvider.Apple)
    assertEquals(AccountStore.Phase.Ready, store.phase.value)
    assertEquals(1, service.log.size)
    assertEquals(listOf(store.memberId), store.members.map { it.id })
    assertEquals(14, store.safetyCode?.length)
    assertEquals(listOf<AccountStore.Event>(AccountStore.Event.SignedIn(AccountSignInProvider.Apple, true)), events)
    assertEquals(service.log[0].hash, memory.vault.root?.genesisHash)
    assertEquals("ios", memory.vault.keys?.kind)
  }

  @Test fun deviceAlreadyOnTheAccountResumes() = runTest {
    val phone = TestKey(1)
    service.seed(listOf(service.genesis(phone)))
    val (store, _) = store(AccountVault(keys = phone.deviceKeys))
    val events = store.recordEvents()
    store.start()
    store.signIn(AccountSignInProvider.GitHub)
    assertEquals(AccountStore.Phase.Ready, store.phase.value)
    assertTrue(service.batches.isEmpty())
    assertEquals(listOf<AccountStore.Event>(AccountStore.Event.SignedIn(AccountSignInProvider.GitHub, false)), events)
    assertNull(store.signingInWith.value)
  }

  @Test fun secondDeviceAsksToJoin() = runTest {
    service.seed(listOf(service.genesis(TestKey(1))))
    val (store, _) = store()
    store.start()
    store.signIn(AccountSignInProvider.Apple)
    assertEquals(AccountStore.Phase.AwaitingApproval, store.phase.value)
    assertEquals(JoinFlow.Waiting, store.join.value)
    assertEquals(1, service.joinIds.size)
    assertTrue(service.batches.isEmpty())
  }

  @Test fun launchShowsCachedHostsFirst() = runTest {
    val phone = TestKey(1)
    val mini = TestKey(2)
    val g = service.genesis(phone)
    val add = AccountEntryBuilder.make(
      service.accountId, 0, AccountHead(0, g.hash), signer = phone.signer,
      fields = AccountEntryBuilder.Fields.AddHost(mini.host("Mini"), "", "", mini.proof(mini.host("Mini"))),
    )
    val state = AccountLog.verify(listOf(g, add)).state!!
    service.seed(listOf(g, add))
    auth.signedIn = true
    val (store, _) = store(AccountVault(keys = phone.deviceKeys, root = state.root, entries = listOf(g, add)))
    var published = emptyList<DeviceIdentity>()
    store.onHostsChanged = { published = it }
    store.start()
    assertEquals(AccountStore.Phase.Ready, store.phase.value)
    assertEquals(listOf<String?>(mini.id), published.map { it.accountHostId })
    assertEquals(mini.noisePub, published.first().desktopPubB64)
    assertEquals(phone.noisePub, published.first().devPubB64)
    assertEquals(DeviceIdentity.Source.Account, published.first().source)
  }

  @Test fun offlineLaunchKeepsAccountAndNextRefreshConfigures() = runTest {
    val phone = TestKey(1)
    val g = service.genesis(phone)
    val state = AccountLog.verify(listOf(g)).state!!
    service.seed(listOf(g))
    service.configDown = true
    val (store, memory) = store(AccountVault(keys = phone.deviceKeys, root = state.root, entries = listOf(g)))
    val events = store.recordEvents()
    store.start()
    store.refresh()
    assertEquals(AccountStore.Phase.Ready, store.phase.value)
    assertTrue(events.isEmpty())
    assertEquals(phone.deviceKeys, memory.load().keys)

    service.configDown = false
    auth.signedIn = true
    store.refresh()
    assertEquals(AccountStore.Phase.Ready, store.phase.value)
    assertEquals("pk_test", auth.configuredKey)
    assertTrue(events.isEmpty())
  }

  @Test fun retryAfterFailedSetupNeedsNoNewSignIn() = runTest {
    service.appendDown = true
    val (store, _) = store()
    store.start()
    store.signIn(AccountSignInProvider.GitHub)
    assertEquals(AccountStore.Phase.SignedOut, store.phase.value)
    assertTrue(auth.signedIn)
    service.appendDown = false
    store.signIn(AccountSignInProvider.GitHub)
    assertEquals(AccountStore.Phase.Ready, store.phase.value)
    assertNull(store.error.value)
  }

  private suspend fun TestScope.readyStore(): AccountStore {
    val (store, _) = store()
    store.start()
    store.signIn(AccountSignInProvider.Apple)
    return store
  }

  private fun bodies(batch: List<dev.houwert.argus.kit.account.AccountEntry>) = batch.map { Json.parseToJsonElement(it.body) as JsonObject }

  @Test fun linkWritesHostAndWindowInOneBatch() = runTest {
    val store = readyStore()
    val events = store.recordEvents()
    val mini = TestKey(2)
    val window = TestKey(3)
    val host = mini.host("Mini")
    val device = window.device("Mini window", kind = "electron")
    service.addLink("req-1", "WDJB-MJHT", AccountLinkSubject(host, device, mapOf(host.id to mini.proof(host), device.id to window.proof(device))))

    store.link("wdjb mjht")
    val confirm = assertIs<LinkFlow.Confirm>(store.link.value)
    assertEquals("Mini", confirm.hostName)
    val state = store.state.value!!
    val expected = AccountSas.compute(AccountSas.Input(state.accountId, 0, state.head.hash, store.members.first().signPub, host.signPub, host.noisePub, "req-1"))
    assertEquals(expected.sas, confirm.sas)

    store.confirmLink()
    assertEquals(LinkFlow.Done("Mini"), store.link.value)
    val batch = bodies(service.batches.last())
    assertEquals(listOf("add_host", "add_device"), batch.map { it["type"]!!.jsonPrimitive.content })
    assertTrue(batch.all { it["request_id"]!!.jsonPrimitive.content == "req-1" })
    assertTrue(batch.all { it["sas_commit"]!!.jsonPrimitive.content == expected.commit })
    assertTrue(store.state.value!!.admits(host.id, "req-1", expected.commit))
    assertEquals(listOf(host.id), store.hosts.value.map { it.id })
    assertEquals(listOf<AccountStore.Event>(AccountStore.Event.ComputerAdded(false)), events)
    assertEquals("approved", service.linkStatus("req-1"))
  }

  @Test fun movedHeadOnAppendComparesANewCode() = runTest {
    val store = readyStore()
    val mini = TestKey(2)
    val host = mini.host("Mini")
    service.addLink("req-2", "BCDF-GHJK", AccountLinkSubject(host, null, mapOf(host.id to mini.proof(host))))
    store.link("BCDF-GHJK")
    val first = assertIs<LinkFlow.Confirm>(store.link.value)

    // Another device renames this one meanwhile, signed with its own key.
    val signer = AccountSigner(store.memberId!!, AccountCodec.fromB64(store.vault.keys!!.signSeed)!!)
    val state = store.state.value!!
    service.inject(AccountEntryBuilder.make(state.accountId, 0, state.head, signer = signer, fields = AccountEntryBuilder.Fields.Rename(signer.id, "Renamed")))

    store.confirmLink()
    val second = assertIs<LinkFlow.Confirm>(store.link.value)
    assertEquals(1, store.state.value?.head?.seq)
    assertTrue(second.sas != first.sas || store.state.value?.head?.hash != state.head.hash)

    store.confirmLink()
    assertEquals(LinkFlow.Done("Mini"), store.link.value)
    assertEquals(3, service.log.size)
  }

  @Test fun aLinkBeingApprovedHereIsNotListedAsWaiting() = runTest {
    val store = readyStore()
    val mini = TestKey(2)
    val host = mini.host("Mini")
    service.addLink("req-4", "BCDF-GHJK", AccountLinkSubject(host, null, mapOf(host.id to mini.proof(host))))
    service.addJoin(TestKey(5).device("Tablet"), TestKey(5).proof(TestKey(5).device("Tablet")))
    store.link("BCDF-GHJK")
    store.refreshRequests()
    assertEquals(listOf("Tablet"), store.requests.value.map { it.subject?.member?.name })
  }

  @Test fun mismatchedCodesDenyTheRequest() = runTest {
    val store = readyStore()
    val mini = TestKey(2)
    val host = mini.host("Mini")
    service.addLink("req-3", "BCDF-GHJK", AccountLinkSubject(host, null, mapOf(host.id to mini.proof(host))))
    store.link("BCDF-GHJK")
    store.denyLink()
    assertEquals(LinkFlow.Idle, store.link.value)
    assertEquals("denied", service.linkStatus("req-3"))
    assertEquals(1, service.log.size)
  }

  private suspend fun linkMini(store: AccountStore): AccountMember {
    val mini = TestKey(2)
    val host = mini.host("Mini")
    service.addLink("r", "BCDF-GHJK", AccountLinkSubject(host, null, mapOf(host.id to mini.proof(host))))
    store.link("BCDF-GHJK")
    store.confirmLink()
    return host
  }

  @Test fun removingAHostRevokesIt() = runTest {
    val store = readyStore()
    val host = linkMini(store)
    val events = store.recordEvents()
    store.remove(host.id)
    assertTrue(store.hosts.value.isEmpty())
    assertEquals(listOf<AccountStore.Event>(AccountStore.Event.MemberRemoved(AccountMember.Role.Host)), events)
  }

  @Test fun signOutRevokesAndForgets() = runTest {
    val store = readyStore()
    val me = store.memberId!!
    store.signOut()
    assertEquals(AccountStore.Phase.SignedOut, store.phase.value)
    assertTrue(auth.signedOut)
    assertNull(store.memberId)
    assertTrue("\"unlinked\"" in service.log.last().body)
    assertNull(AccountLog.verify(service.log).state?.liveMember(me))
  }

  @Test fun presenceIsVerifiedAgainstTheLog() = runTest {
    val store = readyStore()
    val host = linkMini(store)
    val mini = TestKey(2)
    val body = """{"v":1,"account_id":"${service.accountId}","epoch":0,"host_id":"${host.id}","ts":5,"endpoints":[{"kind":"cloudflare","url":"wss://new.example","priority":2}]}"""
    val sig = AccountCodec.sign(AccountCodec.presenceSigningBytes(body), mini.seed)
    val forged = AccountCodec.sign(AccountCodec.presenceSigningBytes(body), ByteArray(32) { 7 })
    val now = System.currentTimeMillis().toDouble()
    service.setDirectory(listOf(AccountDirectoryRecord(host.id, body, forged, now), AccountDirectoryRecord(host.id, body, sig, now)))
    var published = emptyList<DeviceIdentity>()
    store.onHostsChanged = { published = it }
    store.refreshDirectory()
    assertEquals(true, store.host(host.id)?.online)
    assertEquals(listOf("wss://new.example"), store.host(host.id)?.endpoints?.map { it.url })
    assertEquals("wss://new.example", published.first().url)
  }

  @Test fun macFirstSignInLinksItsBundledHost() = runTest {
    val mac = TestKey(4)
    val local = FakeLocalHost(mac.host("This Mac"), mac.proof(mac.host("This Mac")))
    val (store, _) = store(localHost = local)
    store.start()
    store.signIn(AccountSignInProvider.Apple)
    assertEquals(AccountStore.Phase.Ready, store.phase.value)
    assertEquals(2, service.log.size)
    val body = Json.parseToJsonElement(service.log[1].body) as JsonObject
    assertEquals("add_host", body["type"]!!.jsonPrimitive.content)
    assertEquals("", body["request_id"]!!.jsonPrimitive.content)
    assertEquals(service.log[0].hash, local.finished?.genesisHash)
    assertTrue(store.localHostLinked)
    assertEquals(true, store.hosts.value.firstOrNull()?.isLocal)
    assertTrue(store.hostIdentities.isEmpty())
  }

  @Test fun hostNotUpAtSignInIsAddedOnceItIs() = runTest {
    val mac = TestKey(4)
    val local = FakeLocalHost(mac.host("This Mac"), mac.proof(mac.host("This Mac"))).apply { down = true }
    val (store, _) = store(localHost = local)
    store.start()
    store.signIn(AccountSignInProvider.Apple)
    assertEquals(AccountStore.Phase.Ready, store.phase.value)
    assertTrue(!store.localHostLinked)
    assertEquals("Waiting for this Mac's host to start.", store.localLinkError.value)
    local.down = false
    store.linkLocalHost()
    assertTrue(store.localHostLinked)
    assertNull(store.localLinkError.value)
  }

}

class FakeLocalHost(val member: AccountMember, val proof: String) : AccountLocalHostLinking {
  var finished: AccountRoot? = null
  var down = false
  var linked: LocalHostLinkInfo? = null

  override suspend fun status(): LocalHostLinkInfo? {
    if (down) throw TransportException.NotReady()
    return linked
  }
  override suspend fun begin(): Pair<AccountMember, String> {
    if (down) throw TransportException.NotReady()
    return member to proof
  }
  override suspend fun finish(root: AccountRoot) {
    finished = root
    linked = LocalHostLinkInfo(root.accountId, root.epoch, member.id)
  }
  override suspend fun unlink() { linked = null }
}
