package dev.houwert.argus.app

import android.os.Build
import dev.houwert.argus.kit.net.PairingClient
import dev.houwert.argus.kit.net.PairingPayload
import kotlinx.serialization.json.Json

/**
 * Debug builds only: on an emulator a host on this machine's loopback is
 * `10.0.2.2`, so a pairing code naming `127.0.0.1` or `localhost` is rewritten.
 */
object DevPairing {
  fun rewrite(raw: String): String {
    if (!isEmulator) return raw
    val payload = runCatching { PairingClient.parse(raw) }.getOrNull() ?: return raw
    val url = payload.url.replace("://127.0.0.1", "://10.0.2.2").replace("://localhost", "://10.0.2.2")
    if (url == payload.url) return raw
    return Json.encodeToString(PairingPayload.serializer(), payload.copy(url = url))
  }

  private val isEmulator: Boolean
    get() = Build.FINGERPRINT.startsWith("generic") || Build.HARDWARE in setOf("goldfish", "ranchu") || Build.PRODUCT.contains("sdk")
}
