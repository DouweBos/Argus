package dev.houwert.argus.core.account

import dev.houwert.argus.core.support.FakeAccountAuth
import dev.houwert.argus.core.support.FakeAccountService
import dev.houwert.argus.kit.account.AccountEntry
import dev.houwert.argus.kit.account.AccountEntryBuilder
import dev.houwert.argus.kit.account.AccountHead
import dev.houwert.argus.kit.account.AccountLog
import dev.houwert.argus.kit.account.AccountServiceError
import dev.houwert.argus.kit.account.AccountSignInProvider
import dev.houwert.argus.kit.account.AccountVault
import dev.houwert.argus.kit.account.MemoryAccountVault
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest

/** A live member works on its own key: only a removal, a reset or a sign-out takes it off. */
class AccountMemberAuthTest {
  private val service = FakeAccountService()
  private val auth = FakeAccountAuth()
  private val phone = TestKey(1)
  private val tablet = TestKey(3)
  private val events = mutableListOf<AccountStore.Event>()

  private fun genesis() = service.genesis(phone, "Phone", ts = 1)

  /** This phone, cached on a one-device account, launched with or without a Clerk session. */
  private suspend fun TestScope.launch(signedIn: Boolean, extra: List<AccountEntry> = emptyList()): Pair<AccountStore, MemoryAccountVault> {
    val g = genesis()
    val state = AccountLog.verify(listOf(g)).state!!
    service.seed(listOf(g) + extra)
    auth.signedIn = signedIn
    val (store, memory) = makeStore(backgroundScope, service, auth, AccountVault(keys = phone.deviceKeys, root = state.root, entries = listOf(g)))
    store.onEvent = { events += it }
    store.start()
    return store to memory
  }

  private fun revokePhone(by: TestKey) = service.append(AccountEntryBuilder.Fields.Revoke(phone.id, "removed"), by.signer)

  private fun tabletEntry(): AccountEntry {
    val g = genesis()
    val member = tablet.device("Tablet")
    return AccountEntryBuilder.make(service.accountId, 0, AccountHead(0, g.hash), signer = phone.signer, fields = AccountEntryBuilder.Fields.AddDevice(member, "", "", tablet.proof(member)))
  }

  @Test fun noSessionStaysOnAndSyncsOnItsKey() = runTest {
    val (store, memory) = launch(signedIn = false)
    store.refresh()
    assertEquals(AccountStore.Phase.Ready, store.phase.value)
    assertNull(store.error.value)
    assertTrue(events.isEmpty())
    assertTrue(!store.removedNotice)
    assertEquals(phone.deviceKeys, memory.load().keys)
    assertTrue("log" in service.memberSigned)
    assertTrue("directory" in service.memberSigned)
    assertTrue(service.clerkAuthed.isEmpty())
  }

  @Test fun signedInStillSignsWithItsKey() = runTest {
    val (store, _) = launch(signedIn = true)
    store.refresh()
    assertEquals(AccountStore.Phase.Ready, store.phase.value)
    assertTrue(service.memberSigned.isNotEmpty())
    assertTrue(service.clerkAuthed.isEmpty())
  }

  @Test fun removalReachesADeviceWithNoSession() = runTest {
    val (store, memory) = launch(signedIn = false, extra = listOf(tabletEntry()))
    revokePhone(tablet)
    store.refresh()
    assertEquals(AccountStore.Phase.SignedOut, store.phase.value)
    assertTrue(store.removedNotice)
    assertEquals("This device was removed from your account.", store.error.value)
    assertEquals(listOf<AccountStore.Event>(AccountStore.Event.MemberAuth(MemberAuthOutcome.Removed)), events)
    assertNull(memory.load().keys)
    store.dismissRemovedNotice()
    assertTrue(!store.removedNotice)
  }

  @Test fun signingInAfterRemovalAsksToJoin() = runTest {
    val (store, _) = launch(signedIn = false, extra = listOf(tabletEntry()))
    revokePhone(tablet)
    store.refresh()
    store.signIn(AccountSignInProvider.GitHub)
    assertEquals(AccountStore.Phase.AwaitingApproval, store.phase.value)
    assertTrue(!store.removedNotice)
  }

  @Test fun deliberateSignOutShowsNoNotice() = runTest {
    val (store, _) = launch(signedIn = true)
    store.signOut()
    assertEquals(AccountStore.Phase.SignedOut, store.phase.value)
    assertTrue(!store.removedNotice)
    assertTrue(auth.signedOut)
  }

  @Test fun oldServiceFallsBackToClerkOnce() = runTest {
    service.deviceAuth = FakeAccountService.DeviceAuth.Legacy
    val (store, _) = launch(signedIn = true)
    store.refresh()
    store.refresh()
    runCurrent()
    assertEquals(AccountStore.Phase.Ready, store.phase.value)
    assertNull(store.error.value)
    assertTrue(service.memberSigned.isEmpty())
    assertTrue("log" in service.clerkAuthed)
    assertEquals(1, events.count { it == AccountStore.Event.MemberAuth(MemberAuthOutcome.ClerkFallback) })
  }

  @Test fun oldServiceWithoutSessionStaysOn() = runTest {
    service.deviceAuth = FakeAccountService.DeviceAuth.Legacy
    val (store, memory) = launch(signedIn = false)
    store.refresh()
    store.refresh()
    assertEquals(AccountStore.Phase.Ready, store.phase.value)
    assertEquals(AccountServiceError.MemberRefused(403).message, store.error.value)
    assertEquals(listOf<AccountStore.Event>(AccountStore.Event.MemberAuth(MemberAuthOutcome.Refused)), events)
    assertEquals(phone.deviceKeys, memory.load().keys)
  }

  @Test fun resetElsewhereReachesAMember() = runTest {
    val (store, memory) = launch(signedIn = false)
    val other = TestKey(4)
    service.resetElsewhere(service.genesis(other, "Other phone", epoch = 1))
    store.refresh()
    assertEquals(AccountStore.Phase.SignedOut, store.phase.value)
    assertEquals(1, store.resetNotice.value?.epoch)
    assertEquals("Other phone", store.resetNotice.value?.byName)
    assertEquals(listOf<AccountStore.Event>(AccountStore.Event.AccountReset(ResetAction.Seen)), events)
    assertNull(memory.load().keys)
  }

  @Test fun resetWithoutSignInAsksForOne() = runTest {
    val (store, _) = launch(signedIn = false)
    assertTrue(store.canReset)
    store.beginReset()
    assertEquals(IdentityAction.Reset, store.signInNeeded.value)
    assertEquals(ResetFlow.Idle, store.reset.value)
    assertEquals(AccountStore.Phase.Ready, store.phase.value)
    assertEquals(listOf<AccountStore.Event>(AccountStore.Event.AccountReset(ResetAction.SignInNeeded)), events)
    store.signIn(AccountSignInProvider.GitHub)
    assertEquals(AccountStore.Phase.Ready, store.phase.value)
    assertNull(store.signInNeeded.value)
    assertTrue(service.batches.isEmpty())
  }
}
