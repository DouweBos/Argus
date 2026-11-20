package dev.houwert.argus.core.automations

import dev.houwert.argus.kit.protocol.generated.RemoteRunner

/** The second line a runner picker shows: why it can't be picked, else that it's the user's own. */
object RunnerPickerHint {
  fun hint(available: Boolean, reason: String?, isCustom: Boolean): String? =
    if (!available) reason ?: "Not installed on this computer" else if (isCustom) "Custom" else null
}

val RemoteRunner.pickerHint: String? get() = RunnerPickerHint.hint(isAvailable, unavailableReason, isCustom)
