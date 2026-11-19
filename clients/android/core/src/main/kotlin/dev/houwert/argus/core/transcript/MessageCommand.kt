package dev.houwert.argus.core.transcript

import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteMessageCommand

/** What the chip reads: `/compact`. */
val RemoteMessageCommand.label: String get() = "/$name"

/** The text under a command's chip (its arguments), or the message's own text otherwise. */
val RemoteMessage.bodyBlocks: List<String>
  get() {
    val command = command ?: return displayBlocks
    return listOfNotNull(command.args)
  }
