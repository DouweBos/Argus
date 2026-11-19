package dev.houwert.argus.app.storage

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import dev.houwert.argus.kit.net.NetworkPathSignature
import dev.houwert.argus.kit.net.NetworkPathWatcher

/** The default network moving (Wi-Fi joined, VPN up, cellular took over), from `ConnectivityManager`. */
class AndroidNetworkPathWatcher(context: Context) : NetworkPathWatcher {
  private val connectivity = context.getSystemService(ConnectivityManager::class.java)
  private val signature = NetworkPathSignature()
  private var callback: ConnectivityManager.NetworkCallback? = null

  override fun start(onChange: () -> Unit) {
    stop()
    val cb = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) = report(network, onChange)
      override fun onLost(network: Network) {
        if (signature.swap("none")) onChange()
      }
      override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = report(network, onChange)
      override fun onLinkPropertiesChanged(network: Network, link: LinkProperties) = report(network, onChange)
    }
    callback = cb
    runCatching { connectivity.registerDefaultNetworkCallback(cb) }
  }

  override fun stop() {
    callback?.let { runCatching { connectivity.unregisterNetworkCallback(it) } }
    callback = null
  }

  private fun report(network: Network, onChange: () -> Unit) {
    val caps = connectivity.getNetworkCapabilities(network)
    val link = connectivity.getLinkProperties(network)
    val transports = listOf(
      NetworkCapabilities.TRANSPORT_WIFI, NetworkCapabilities.TRANSPORT_CELLULAR,
      NetworkCapabilities.TRANSPORT_VPN, NetworkCapabilities.TRANSPORT_ETHERNET,
    ).filter { caps?.hasTransport(it) == true }
    val addresses = link?.linkAddresses?.map { it.address.hostAddress }?.sorted().orEmpty()
    if (signature.swap("$network|$transports|$addresses")) onChange()
  }
}
