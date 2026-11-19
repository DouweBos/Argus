package dev.houwert.argus.core.devices

import dev.houwert.argus.kit.media.MediaMessage

/**
 * Routes parsed media to the sink registered for its stream. Frames for a stream
 * nobody holds yet are buffered: the config arrives before `devices.watch` returns.
 */
class MediaRouter {
  private val sinks = mutableMapOf<Int, (MediaMessage) -> Unit>()
  private val buffer = mutableMapOf<Int, ArrayDeque<MediaMessage>>()

  fun register(streamId: Int, sink: (MediaMessage) -> Unit): () -> Unit {
    sinks[streamId] = sink
    buffer.remove(streamId)?.forEach(sink)
    return { if (sinks[streamId] === sink) sinks.remove(streamId) }
  }

  fun deliver(bytes: ByteArray) {
    val message = MediaMessage.parse(bytes) ?: return
    sinks[message.streamId]?.let { return it(message) }
    val queue = buffer.getOrPut(message.streamId) { ArrayDeque() }
    queue.addLast(message)
    if (queue.size > BUFFER_CAP) queue.removeFirst()
  }

  fun clear() {
    sinks.clear()
    buffer.clear()
  }

  private companion object { const val BUFFER_CAP = 120 }
}
