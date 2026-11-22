package dev.houwert.argus.ui.components

import androidx.compose.ui.graphics.vector.ImageVector
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.isPaused
import dev.houwert.argus.kit.protocol.isPinned
import dev.houwert.argus.ui.icons.Icon as ArgusIcon

/** An agent's pill tab glyph. Paused outranks pinned: it's what differs right now. */
val RemoteAgentStatus.tabIcon: ImageVector
  get() = when {
    isPaused -> ArgusIcon.snooze
    isPinned -> ArgusIcon.pin
    else -> ArgusIcon.agent
  }
