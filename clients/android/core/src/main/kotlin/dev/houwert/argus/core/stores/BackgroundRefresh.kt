package dev.houwert.argus.core.stores

import kotlinx.coroutines.asContextElement
import kotlinx.coroutines.withContext

/**
 * Polls, foreground resumes and reconnect reloads run as background refreshes.
 * One that fails only because the connection was down is retried on the next
 * connection rather than reported. Coroutines started inside inherit it.
 */
object BackgroundRefresh {
  private val active = ThreadLocal.withInitial { false }

  val isActive: Boolean get() = active.get()

  suspend fun <T> run(body: suspend () -> T): T = withContext(active.asContextElement(true)) { body() }
}
