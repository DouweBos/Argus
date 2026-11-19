package dev.houwert.argus.kit.net

import java.util.concurrent.TimeUnit
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString

/**
 * A binary WebSocket to the gateway, carrying raw Noise frames. Reconnects on
 * its own (1 s doubling to 30 s, reset on open) because the phone loses the
 * network constantly. OkHttp pings keep NATs from dropping an idle socket and
 * notice a dead one.
 */
class GatewaySocket(
  private val url: String,
  private val scope: CoroutineScope,
  private val client: OkHttpClient = sharedClient,
) {
  sealed interface Event {
    data object Open : Event
    class Frame(val data: ByteArray) : Event
    data object Closed : Event
  }

  private val _events = MutableSharedFlow<Event>(extraBufferCapacity = 256)
  /** Lives across reconnects, emitting `Open` / `Closed` each cycle. */
  val events: SharedFlow<Event> = _events

  @Volatile private var socket: WebSocket? = null
  @Volatile private var closedByUs = false
  private var backoff: Duration = 1.seconds
  private var reconnect: Job? = null
  private val lock = Any()

  fun connect() {
    closedByUs = false
    open()
  }

  fun close() {
    closedByUs = true
    synchronized(lock) {
      reconnect?.cancel()
      reconnect = null
      socket?.close(1001, null)
      socket = null
    }
  }

  fun send(data: ByteArray): Boolean = socket?.send(data.toByteString()) ?: false

  /** Back in the foreground: a socket that died while suspended reconnects now. */
  fun checkAlive() {
    if (socket == null && !closedByUs) {
      synchronized(lock) { reconnect?.cancel(); reconnect = null }
      open()
    }
  }

  private fun open() {
    if (closedByUs) return
    val request = Request.Builder().url(url.replaceFirst("wss://", "https://").replaceFirst("ws://", "http://")).build()
    val listener = object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: Response) {
        if (webSocket !== socket) return
        backoff = 1.seconds
        _events.tryEmit(Event.Open)
      }

      override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
        if (webSocket === socket) _events.tryEmit(Event.Frame(bytes.toByteArray()))
      }

      override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
        webSocket.close(1000, null)
        drop(webSocket)
      }

      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = drop(webSocket)

      override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = drop(webSocket)
    }
    synchronized(lock) { socket = client.newWebSocket(request, listener) }
  }

  /** Only the current socket drives a reconnect; a stale one failing late must not. */
  private fun drop(dead: WebSocket) {
    synchronized(lock) {
      if (dead !== socket) return
      socket = null
    }
    if (closedByUs) return
    _events.tryEmit(Event.Closed)
    scheduleReconnect()
  }

  private fun scheduleReconnect() = synchronized(lock) {
    if (reconnect != null) return
    val wait = backoff
    backoff = minOf(backoff * 2, MAX_BACKOFF)
    reconnect = scope.launch {
      delay(wait)
      synchronized(lock) { reconnect = null }
      open()
    }
  }

  companion object {
    private val MAX_BACKOFF = 30.seconds

    val sharedClient: OkHttpClient = OkHttpClient.Builder()
      .pingInterval(25, TimeUnit.SECONDS)
      .readTimeout(0, TimeUnit.MILLISECONDS)
      .connectTimeout(10, TimeUnit.SECONDS)
      .build()
  }
}
