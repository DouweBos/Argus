package dev.houwert.argus.core.stores

import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.core.support.bool
import dev.houwert.argus.core.support.string
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.RemoteViewedFileState
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import org.junit.Test

class NotificationsLogTest {
  private var now = 1_000_000L
  private val log = NotificationsLog { now }

  @Test fun aRepeatCollapsesIntoTheNewestEntryAndDoesntCountAsNew() {
    log.push(NotificationsLog.Level.Error, "offline", "agents")
    log.markSeen()
    now += 1000
    log.push(NotificationsLog.Level.Error, "offline", "agents")
    assertEquals(1, log.entries.value.size)
    assertEquals(2, log.entries.value[0].count)
    assertEquals(now, log.entries.value[0].timestamp)
    assertEquals(0, log.unseenCount)

    now += 1000
    log.push(NotificationsLog.Level.Warning, "offline", "agents")
    log.push(NotificationsLog.Level.Error, "offline", "agents")
    assertEquals(listOf(NotificationsLog.Level.Error, NotificationsLog.Level.Warning, NotificationsLog.Level.Error), log.entries.value.map { it.level })
    assertEquals(2, log.unseenCount)
  }

  @Test fun newestFirstCappedAndOneCanBeDismissed() {
    repeat(NotificationsLog.CAP + 5) {
      now += 1000
      log.push(NotificationsLog.Level.Error, "e$it")
    }
    assertEquals(NotificationsLog.CAP, log.entries.value.size)
    assertEquals("e${NotificationsLog.CAP + 4}", log.entries.value.first().message)
    val id = log.entries.value[0].id
    log.dismiss(id)
    assertTrue(log.entries.value.none { it.id == id })
    log.clear()
    assertTrue(log.entries.value.isEmpty() && log.unseenCount == 0)
  }
}

class GitStoresTest {
  @Test fun aCheckoutBlockedByUncommittedChangesAsksRatherThanFailing() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(Methods.SessionsCheckout, """{"accepted":false,"blocked_by":"dirty"}""")
    attach(store, backend)

    assertEquals(CheckoutOutcome.Dirty, store.checkoutBranch("s-1", "/r", "feature"))

    backend.reply(Methods.SessionsCheckout, """{"accepted":true}""")
    backend.reply(Methods.SessionsList, """{"sessions":[]}""")
    assertEquals(CheckoutOutcome.Ok, store.checkoutBranch("s-1", "/r", "feature", dirty = "stash"))
    assertEquals("stash", backend.params(Methods.SessionsCheckout)?.string("dirty"))
  }

  @Test fun anUnmergedBranchAsksBeforeAForcedDelete() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(Methods.SessionsDeleteBranch, """{"accepted":false,"blocked_by":"unmerged"}""")
    attach(store, backend)

    assertEquals(DeleteBranchOutcome.Unmerged, store.deleteBranch("s-1", "old"))
    backend.reply(Methods.SessionsDeleteBranch, """{"accepted":true}""")
    assertEquals(DeleteBranchOutcome.Ok, store.deleteBranch("s-1", "old", force = true))
    assertEquals(true, backend.params(Methods.SessionsDeleteBranch)?.bool("force"))
  }

  @Test fun aFailedBranchActionLandsOnTheBanner() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.fail(Methods.SessionsMergeBranch)
    attach(store, backend)

    assertEquals(false, store.mergeIntoCurrent("s-1", "feature", squash = true))
    assertNotNull(store.lastError.value)
  }

  @Test fun aViewedTickThatFailsRollsBackAndSaysSo() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(Methods.SessionsViewedFiles, """{"files":[{"path":"a.ts","state":"changed"}]}""")
    backend.fail(Methods.SessionsSetFileViewed)
    attach(store, backend)
    val viewed = ViewedFiles(ViewedFiles.Scope.Session("s-1", "branch"), store)

    viewed.load()
    assertEquals(RemoteViewedFileState.changed, viewed.state("a.ts"))
    viewed.set("a.ts", viewed = true)
    assertEquals(RemoteViewedFileState.changed, viewed.state("a.ts"))
    assertNotNull(viewed.error.value)
  }
}
