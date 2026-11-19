package dev.houwert.argus.kit.net

/**
 * Announces when the device's network path changes: Wi-Fi joined or left, a
 * VPN (Tailscale) came up, cellular took over. The app implements it over
 * `ConnectivityManager`; the first report is the starting point, not a change.
 */
interface NetworkPathWatcher {
  /** Calls [onChange] each time the path moves, on any thread. */
  fun start(onChange: () -> Unit)
  fun stop()
}

/** Tells a real path change from a repeat report; implementations feed it a signature per callback. */
class NetworkPathSignature {
  private var value: String? = null

  /** Store [next]; true when it differs from a previous one. */
  @Synchronized
  fun swap(next: String): Boolean {
    val changed = value != null && value != next
    value = next
    return changed
  }
}
