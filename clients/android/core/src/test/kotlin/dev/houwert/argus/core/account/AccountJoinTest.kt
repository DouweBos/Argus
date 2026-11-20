package dev.houwert.argus.core.account

import dev.houwert.argus.core.support.FakeAccountAuth
import dev.houwert.argus.core.support.FakeAccountService
import dev.houwert.argus.kit.account.AccountCodec
import dev.houwert.argus.kit.account.AccountDeviceKeys
import dev.houwert.argus.kit.account.AccountEntryBuilder
import dev.houwert.argus.kit.account.AccountHead
import dev.houwert.argus.kit.account.AccountLog
import dev.houwert.argus.kit.account.AccountMember
import dev.houwert.argus.kit.account.AccountSas
import dev.houwert.argus.kit.account.AccountSignInProvider
import dev.houwert.argus.kit.account.AccountVault
import dev.houwert.argus.kit.account.MemoryAccountVault
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest

/** Device approval from both ends, plus renaming and handing entries to a host. */
class AccountJoinTest {
  private val service = FakeAccountService()
  private val auth = FakeAccountAuth()
  private val phone = TestKey(1)

  private fun TestScope.store(vault: AccountVault = AccountVault.EMPTY) = makeStore(backgroundScope, service, auth, vault, kind = "mac", name = { "Studio" })
  private fun TestScope.relaunch(memory: MemoryAccountVault) =
    AccountStore(backgroundScope, auth, memory, "mac", { "Studio" }, null, BASE_URL, service.http, System::currentTimeMillis, NEVER)

  private fun genesis() = service.genesis(phone, "Phone")

  /** The phone approves [requestId] for [member] with [commit], as its own device would. */
  private fun phoneApproves(requestId: String, member: AccountMember, proof: String, commit: String) {
    service.append(AccountEntryBuilder.Fields.AddDevice(member, requestId, commit, proof), phone.signer)
    service.setJoinStatus(requestId, "approved")
  }

  private fun proof(keys: AccountDeviceKeys) = AccountEntryBuilder.proof(keys.member, AccountCodec.fromB64(keys.signSeed)!!)

  private data class Joining(val store: AccountStore, val memory: MemoryAccountVault, val requestId: String, val sas: AccountSas)

  /** A new Mac signed in on the phone's account, its request picked up by the phone. */
  private suspend fun TestScope.joiningMac(): Joining {
    service.seed(listOf(genesis()))
    val (store, memory) = store()
    store.start()
    store.signIn(AccountSignInProvider.GitHub)
    val requestId = service.joinIds.first()
    val head = service.pickUp(requestId, phone.id, phone.signPub)
    store.pollJoin()
    val keys = memory.vault.keys!!
    val sas = AccountSas.compute(AccountSas.Input(service.accountId, 0, head.hash, phone.signPub, keys.signPub, keys.noisePub, requestId))
    return Joining(store, memory, requestId, sas)
  }

  @Test fun newDeviceShowsTheCodeAndJoinsWithIt() = runTest {
    val (store, memory, requestId, sas) = joiningMac()
    val events = store.recordEvents()
    assertEquals(JoinFlow.Compare(sas.sas, "Phone"), store.join.value)
    store.confirmJoinCode()
    assertEquals(JoinFlow.Confirmed("Phone"), store.join.value)
    val keys = memory.vault.keys!!
    phoneApproves(requestId, keys.member, proof(keys), sas.commit)
    store.pollJoin()
    assertEquals(AccountStore.Phase.Ready, store.phase.value)
    assertEquals(JoinFlow.Idle, store.join.value)
    assertEquals(listOf(phone.id, keys.memberId).sorted(), store.members.map { it.id }.sorted())
    assertEquals(service.log[0].hash, memory.vault.root?.genesisHash)
    assertNull(memory.vault.joinCommit)
    assertEquals(
      listOf(
        AccountStore.Event.JoinActed(AccountStore.JoinAction.Approved, AccountStore.JoinRole.Subject),
        AccountStore.Event.SignedIn(AccountSignInProvider.GitHub, false),
      ),
      events,
    )
  }

  @Test fun approvalWithAnotherCodeIsRefused() = runTest {
    val (store, memory, requestId, _) = joiningMac()
    store.confirmJoinCode()
    val keys = memory.vault.keys!!
    phoneApproves(requestId, keys.member, proof(keys), "0".repeat(64))
    store.pollJoin()
    assertEquals(AccountStore.Phase.AwaitingApproval, store.phase.value)
    assertIs<JoinFlow.Failed>(store.join.value)
    assertNull(memory.vault.root)
  }

  @Test fun unconfirmedApprovalIsNotAdoptedEvenAfterRelaunch() = runTest {
    val (store, memory, requestId, sas) = joiningMac()
    val keys = memory.vault.keys!!
    phoneApproves(requestId, keys.member, proof(keys), sas.commit)
    store.pollJoin()
    assertEquals(AccountStore.Phase.AwaitingApproval, store.phase.value)
    val relaunched = relaunch(memory)
    relaunched.start()
    assertEquals(AccountStore.Phase.AwaitingApproval, relaunched.phase.value)
    assertEquals(JoinFlow.AlreadyApproved(sas.sas, "Phone"), relaunched.join.value)
    assertNull(memory.vault.root)
  }

  @Test fun mismatchedCodesDenyOnTheJoiningDevice() = runTest {
    val (store, _, requestId, _) = joiningMac()
    val events = store.recordEvents()
    store.rejectJoinCode()
    assertEquals(JoinFlow.Denied, store.join.value)
    assertEquals("denied", service.join(requestId)?.status)
    assertEquals(listOf<AccountStore.Event>(AccountStore.Event.JoinActed(AccountStore.JoinAction.Denied, AccountStore.JoinRole.Subject)), events)
  }

  private suspend fun TestScope.readyPhone(): AccountStore {
    service.seed(listOf(genesis()))
    auth.signedIn = true
    val state = AccountLog.verify(service.log).state!!
    val (store, _) = store(AccountVault(keys = phone.deviceKeys, root = state.root, entries = service.log.toList()))
    store.start()
    return store
  }

  @Test fun approverComparesTheCodeAndAddsTheDevice() = runTest {
    val store = readyPhone()
    val events = store.recordEvents()
    var appended = 0
    store.onLogAppended = { appended += 1 }
    val tablet = TestKey(5)
    val member = tablet.device("Tablet")
    val requestId = service.addJoin(member, tablet.proof(member))
    service.addJoin(TestKey(6).device("Forged"), tablet.proof(member))

    store.refreshRequests()
    assertEquals(listOf(requestId), store.requests.value.map { it.requestId })
    store.approve(store.requests.value.first())
    val state = store.state.value!!
    val expected = AccountSas.compute(AccountSas.Input(state.accountId, 0, state.head.hash, phone.signPub, member.signPub, member.noisePub, requestId))
    assertEquals(ApprovalFlow.Confirm(expected.sas, "Tablet", AccountMember.Role.Device), store.approval.value)

    store.confirmApproval()
    assertEquals(ApprovalFlow.Done("Tablet", AccountMember.Role.Device), store.approval.value)
    assertTrue(store.state.value!!.admits(member.id, requestId, expected.commit))
    assertTrue(store.requests.value.isEmpty())
    assertEquals(1, appended)
    assertEquals(listOf<AccountStore.Event>(AccountStore.Event.JoinActed(AccountStore.JoinAction.Approved, AccountStore.JoinRole.Approver)), events)
  }

  @Test fun renamingThisDeviceGoesThroughItsNameSetting() = runTest {
    val store = readyPhone()
    val events = store.recordEvents()
    store.rename(phone.id, "  Douwe's phone\n")
    assertEquals("Douwe's phone", store.members.first().name)
    assertEquals(listOf<AccountStore.Event>(AccountStore.Event.NameChanged(AccountStore.NameSource.AccountList, true)), events)
  }

  @Test fun connectedHostGetsTheEntriesItIsMissing() = runTest {
    val store = readyPhone()
    store.rename(phone.id, "Renamed")
    val pushed = mutableListOf<MethodsTypes.AccountSyncParams>()
    val hash = AccountCodec.sha256Hex(service.accountId)
    store.sync(AccountSyncChannel({ MethodsTypes.AccountStatusResult(true, hash, 0) }, { pushed += it }))
    assertEquals(1, pushed.size)
    assertEquals(listOf(service.log[1].body), pushed.first().entries.map { it.body })
    store.sync(AccountSyncChannel({ MethodsTypes.AccountStatusResult(true, "someone-else", 0) }, { pushed += it }))
    assertEquals(1, pushed.size)
  }

  // Resuming after a relaunch

  @Test fun relaunchResumesThePersistedRequest() = runTest {
    val (_, memory, requestId, sas) = joiningMac()
    assertEquals(requestId, memory.vault.pendingJoin?.requestId)
    val relaunched = relaunch(memory)
    relaunched.start()
    assertEquals(JoinFlow.Compare(sas.sas, "Phone"), relaunched.join.value)
    assertEquals(listOf(requestId), service.joinIds)
  }

  @Test fun codeConfirmedBeforeRelaunchStaysConfirmed() = runTest {
    val (store, memory, requestId, sas) = joiningMac()
    store.confirmJoinCode()
    val relaunched = relaunch(memory)
    relaunched.start()
    assertEquals(JoinFlow.Confirmed("Phone"), relaunched.join.value)
    val keys = memory.vault.keys!!
    phoneApproves(requestId, keys.member, proof(keys), sas.commit)
    relaunched.pollJoin()
    assertEquals(AccountStore.Phase.Ready, relaunched.phase.value)
    assertNull(memory.vault.pendingJoin)
    assertEquals(listOf(requestId), service.joinIds)
  }

  @Test fun approvedAndConfirmedBeforeRelaunchIsAdoptedSilently() = runTest {
    val (store, memory, requestId, sas) = joiningMac()
    store.confirmJoinCode()
    val keys = memory.vault.keys!!
    phoneApproves(requestId, keys.member, proof(keys), sas.commit)
    val relaunched = relaunch(memory)
    relaunched.start()
    assertEquals(AccountStore.Phase.Ready, relaunched.phase.value)
    assertEquals(JoinFlow.Idle, relaunched.join.value)
    assertEquals(service.log[0].hash, memory.vault.root?.genesisHash)
  }

  @Test fun approvedWhileAwayIsShownAgainAndAdoptedOnceChecked() = runTest {
    val (_, memory, requestId, sas) = joiningMac()
    val keys = memory.vault.keys!!
    phoneApproves(requestId, keys.member, proof(keys), sas.commit)
    val relaunched = relaunch(memory)
    val events = relaunched.recordEvents()
    relaunched.start()
    assertEquals(JoinFlow.AlreadyApproved(sas.sas, "Phone"), relaunched.join.value)
    assertEquals(listOf(requestId), service.joinIds)
    assertEquals(keys, memory.vault.keys)
    relaunched.confirmApprovedJoin()
    assertEquals(AccountStore.Phase.Ready, relaunched.phase.value)
    assertEquals(listOf(phone.id, keys.memberId).sorted(), relaunched.members.map { it.id }.sorted())
    assertEquals(service.log[0].hash, memory.vault.root?.genesisHash)
    assertEquals(listOf<AccountStore.Event>(AccountStore.Event.JoinActed(AccountStore.JoinAction.Approved, AccountStore.JoinRole.Subject)), events)
  }

  @Test fun approverListsTheCodeItApprovedWith() = runTest {
    val (_, memory, requestId, sas) = joiningMac()
    val keys = memory.vault.keys!!
    phoneApproves(requestId, keys.member, proof(keys), sas.commit)
    val state = AccountLog.verify(service.log).state!!
    val (store, _) = store(AccountVault(keys = phone.deviceKeys, root = state.root, entries = service.log.toList()))
    store.start()
    assertEquals(sas.sas, store.approvalCode(keys.memberId))
    assertNull(store.approvalCode(phone.id))
  }

  @Test fun notMineSignsOutAndForgetsTheKeys() = runTest {
    val (_, memory, requestId, sas) = joiningMac()
    val keys = memory.vault.keys!!
    phoneApproves(requestId, keys.member, proof(keys), sas.commit)
    val relaunched = relaunch(memory)
    relaunched.start()
    relaunched.rejectApprovedJoin()
    assertEquals(AccountStore.Phase.SignedOut, relaunched.phase.value)
    assertNotNull(relaunched.error.value)
    assertEquals(AccountVault.EMPTY, memory.vault)
    assertTrue(auth.signedOut)
  }

  @Test fun uncheckableApprovalIsNeverOffered() = runTest {
    val (_, memory, requestId, _) = joiningMac()
    val keys = memory.vault.keys!!
    phoneApproves(requestId, keys.member, proof(keys), "0".repeat(64))
    val relaunched = relaunch(memory)
    relaunched.start()
    assertIs<JoinFlow.Failed>(relaunched.join.value)
    relaunched.confirmApprovedJoin()
    assertEquals(AccountStore.Phase.AwaitingApproval, relaunched.phase.value)
    assertEquals(listOf(requestId), service.joinIds)
  }

  @Test fun memberDoesNotAskAgain() = runTest {
    val (store, memory, requestId, sas) = joiningMac()
    service.setJoinStatus(requestId, "expired")
    store.pollJoin()
    assertEquals(JoinFlow.Expired, store.join.value)
    assertNull(memory.vault.pendingJoin)

    store.retryJoin()
    val second = service.joinIds.first { it != requestId }
    assertEquals(second, memory.vault.pendingJoin?.requestId)

    // The first request's code was approved after all, while this one waits.
    val keys = memory.vault.keys!!
    phoneApproves(requestId, keys.member, proof(keys), sas.commit)
    store.retryJoin()
    assertEquals(JoinFlow.AlreadyApproved(sas.sas, "Phone"), store.join.value)
    assertEquals(2, service.joinIds.size)
    assertEquals(keys, memory.vault.keys)
    assertEquals("denied", service.join(second)?.status)
  }

  @Test fun approvalOnAnOlderRequestIsFoundWhenTheOpenOneExpires() = runTest {
    val (store, memory, requestId, sas) = joiningMac()
    service.setJoinStatus(requestId, "expired")
    store.pollJoin()
    store.retryJoin()
    val second = service.joinIds.first { it != requestId }
    val keys = memory.vault.keys!!
    phoneApproves(requestId, keys.member, proof(keys), sas.commit)
    service.setJoinStatus(second, "expired")
    store.pollJoin()
    assertEquals(JoinFlow.AlreadyApproved(sas.sas, "Phone"), store.join.value)
  }

}
