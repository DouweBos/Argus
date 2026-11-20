package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.generated.Events
import kotlinx.serialization.json.JsonElement

/**
 * Watch the host's raw `ipc` broadcasts (setup progress and the like), which
 * carry more than the listed models. Returns the call that stops watching.
 */
fun HostStore.observeIpc(handler: (channel: String, args: List<JsonElement>, seq: Int) -> Unit): () -> Unit =
  observeEvents { envelope ->
    if (envelope.event != Events.Ipc.name) return@observeEvents
    val ipc = envelope.decode(Events.Ipc) ?: return@observeEvents
    handler(ipc.channel, ipc.args, envelope.seq)
  }
