package dev.houwert.argus.ui.icons

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.outlined.GraphicEq
import androidx.compose.material.icons.outlined.RecordVoiceOver
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.ui.graphics.vector.ImageVector

/** The composer's send arrow: heavier than [Icon.send] so it reads inside the round button. */
val Icon.arrowUp: ImageVector get() = Icons.Rounded.ArrowUpward

/** A solid square, the interrupt glyph. */
val Icon.stopFilled: ImageVector get() = Icons.Filled.Stop

/** Voice mode's waveform, beside the mic. */
val Icon.voiceMode: ImageVector get() = Icons.Outlined.GraphicEq

/** Voice settings: how replies are read aloud. */
val Icon.voice: ImageVector get() = Icons.Outlined.RecordVoiceOver
