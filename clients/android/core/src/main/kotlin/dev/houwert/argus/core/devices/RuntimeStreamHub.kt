package dev.houwert.argus.core.devices

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.kit.media.MediaMessage
import dev.houwert.argus.kit.protocol.generated.RemotePlatform
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.launch

/**
 * Shares one host stream between every view showing the same device or browser.
 * The host hands a connection a single stream per subject, so two views would
 * otherwise steal each other's frames. Holds `connectionBoundWork` while open.
 */
class RuntimeStreamHub(private val store: HostStore) {
  sealed interface Subject {
    data class Device(val id: String, val platform: RemotePlatform) : Subject
    data class Browser(val sessionId: String) : Subject
  }

  private class Entry {
    val sinks = linkedMapOf<Int, MediaSink>()
    /** Replayed to a late joiner: the decoder needs the parameter sets and everything since the last keyframe. */
    var config: MediaMessage? = null
    val sinceKeyFrame = mutableListOf<MediaMessage>()
    var unregister: (() -> Unit)? = null
    var opening: Deferred<Int?>? = null
  }

  private val entries = mutableMapOf<Subject, Entry>()
  /** Release and unwatch still in flight; a reopen waits so the unwatch can't land after its watch. */
  private val closing = mutableMapOf<Subject, Job>()
  private var nextId = 0

  /** Start receiving [subject]'s frames; null when the host couldn't start the stream. Call the result to stop. */
  suspend fun attach(subject: Subject, sink: MediaSink): (() -> Unit)? {
    val entry = entries.getOrPut(subject) { Entry() }
    val id = nextId++
    entry.sinks[id] = sink
    entry.config?.let(sink)
    entry.sinceKeyFrame.toList().forEach(sink)

    if (entry.unregister == null) {
      val opening = entry.opening ?: store.scope.async {
        closing[subject]?.join()
        open(subject)
      }.also { entry.opening = it }
      val streamId = opening.await()
      if (streamId == null) {
        entry.opening = null
        entry.sinks.remove(id)
        if (entry.sinks.isEmpty()) entries.remove(subject)
        return null
      }
      if (entry.unregister == null) {
        store.connectionBoundWork += 1
        val unregister = store.registerMediaSink(streamId) { deliver(it, entry) }
        entry.unregister = {
          unregister()
          store.connectionBoundWork -= 1
        }
      }
    }
    return { detach(subject, id) }
  }

  private suspend fun open(subject: Subject): Int? = when (subject) {
    is Subject.Device -> store.watchDevice(subject.id, subject.platform)
    is Subject.Browser -> store.watchBrowser(subject.sessionId)
  }

  private fun deliver(message: MediaMessage, entry: Entry) {
    when (message) {
      is MediaMessage.Config -> {
        entry.config = message
        entry.sinceKeyFrame.clear()
      }
      is MediaMessage.Frame -> {
        if (message.keyFrame) entry.sinceKeyFrame.clear()
        if (entry.sinceKeyFrame.size < REPLAY_CAP) entry.sinceKeyFrame += message
      }
      is MediaMessage.Jpeg -> {
        entry.sinceKeyFrame.clear()
        entry.sinceKeyFrame += message
      }
    }
    entry.sinks.values.toList().forEach { it(message) }
  }

  private fun detach(subject: Subject, id: Int) {
    val entry = entries[subject] ?: return
    entry.sinks.remove(id)
    if (entry.sinks.isNotEmpty()) return
    entries.remove(subject)
    entry.unregister?.invoke()
    val job = store.scope.launch {
      // Let go before leaving, so another client isn't locked out by a picture nobody watches.
      when (subject) {
        is Subject.Device -> {
          store.releaseDevice(subject.id)
          store.unwatchDevice(subject.id)
        }
        is Subject.Browser -> store.unwatchBrowser(subject.sessionId)
      }
    }
    closing[subject] = job
    job.invokeOnCompletion { if (closing[subject] === job) closing.remove(subject) }
  }

  private companion object {
    /** A device sending only deltas would grow this forever. */
    const val REPLAY_CAP = 300
  }
}
