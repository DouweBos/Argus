package dev.houwert.argus.core.stores

import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.RemoteSessionStatus
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlinx.coroutines.test.runTest
import org.junit.Test

/** A worktree the computer couldn't make must not sit on "Setting up" forever. */
class SessionSetupFailureTest {
  private val pending =
    """{"id":"s-new","kind":"worktree","branch":"","display_name":"reply with hi","description":"","path":"","repo_root":"/repo","status":"initializing"}"""
  private val failed =
    """{"sessions":[{"id":"s-new","kind":"worktree","branch":"","display_name":"reply with hi","description":"","path":"","repo_root":"/repo","status":"error","setup_error":"Branch \"reply-with-hi\" is already used"}]}"""

  @Test fun aCreateThatFailsAtOnceShowsTheFailureNotThePlaceholder() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(Methods.SessionsCreate, """{"session":$pending}""")
    backend.reply(Methods.SessionsList, failed)
    attach(store, backend)

    store.createSession("/repo", "reply-with-hi", "")

    val session = assertNotNull(store.sessionsByRepo.value["/repo"]?.firstOrNull())
    assertEquals(1, store.sessionsByRepo.value["/repo"]?.size)
    assertEquals(RemoteSessionStatus.error, session.status)
    assertEquals("Branch \"reply-with-hi\" is already used", session.setupError)
  }
}
