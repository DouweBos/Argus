package dev.houwert.argus.core.stores

import dev.houwert.argus.core.backend.HostBackendKind
import dev.houwert.argus.core.terminals.TerminalFeed
import dev.houwert.argus.kit.crypto.ArgusBase64
import dev.houwert.argus.kit.protocol.generated.Events
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteTerminal
import dev.houwert.argus.kit.protocol.generated.RemoteTerminalOutput
import kotlinx.coroutines.launch

// A session's terminals, read-only: what a phone shows of a dev server. Typing stays with the desktop.

suspend fun HostStore.listTerminals(sessionId: String): List<RemoteTerminal> {
  val backend = backend ?: return emptyList()
  return try {
    backend.request(Methods.TerminalsList, MethodsTypes.TerminalsListParams(sessionId)).terminals
  } catch (e: Exception) {
    report(e, "terminals")
    emptyList()
  }
}

/** Null when the terminal is gone (it exited and was swept) or the call failed. */
suspend fun HostStore.readTerminal(id: String): RemoteTerminalOutput? {
  val backend = backend ?: return null
  return runCatching { backend.request(Methods.TerminalsRead, MethodsTypes.TerminalsReadParams(id)) }.getOrNull()
}

/**
 * Follow a terminal's output as it is produced: [deliver] gets the replay of
 * what was captured, then every later chunk exactly once. Returns the call that
 * stops following, or null when the computer can't stream (poll [readTerminal]).
 */
suspend fun HostStore.followTerminal(id: String, deliver: (List<TerminalFeed.Output>) -> Unit): (() -> Unit)? {
  val backend = backend ?: return null
  if (backend.kind != HostBackendKind.Gateway) return null
  val feed = TerminalFeed()
  feed.beginReplay()
  val remove = observeEvents { envelope ->
    when (envelope.event) {
      Events.TerminalData.name -> envelope.decode(Events.TerminalData)?.takeIf { it.terminalId == id }?.let { payload ->
        ArgusBase64.decode(payload.data)?.let { deliver(feed.live(TerminalFeed.Live.Data(it), envelope.seq)) }
      }
      Events.TerminalExit.name -> envelope.decode(Events.TerminalExit)?.takeIf { it.terminalId == id }?.let { payload ->
        deliver(feed.live(TerminalFeed.Live.Exit(payload.exitCode.toInt()), envelope.seq))
      }
    }
  }
  val channel = "terminal:$id"
  backend.subscribe(channel, true)
  connectionBoundWork += 1
  var stopped = false
  val stop = {
    if (!stopped) {
      stopped = true
      remove()
      connectionBoundWork -= 1
      scope.launch { runCatching { backend.subscribe(channel, false) } }
    }
  }
  return try {
    val (scrollback, seq) = backend.sequencedRequest(Methods.TerminalsScrollback, MethodsTypes.TerminalsScrollbackParams(id))
    deliver(feed.replay(ArgusBase64.decode(scrollback.data) ?: ByteArray(0), scrollback.exitCode?.toInt(), seq))
    stop
  } catch (e: Exception) {
    stop()
    null
  }
}
