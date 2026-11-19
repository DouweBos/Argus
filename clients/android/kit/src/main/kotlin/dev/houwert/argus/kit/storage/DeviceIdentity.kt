package dev.houwert.argus.kit.storage

import dev.houwert.argus.kit.crypto.ArgusBase64
import dev.houwert.argus.kit.crypto.NoiseKeypair
import java.net.URI
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class RemoteEndpoint(val kind: Kind, val url: String, val priority: Int) {
  @Serializable
  enum class Kind(val priority: Int, val label: String) {
    @SerialName("lan") Lan(0, "Local network"),
    @SerialName("tailscale") Tailscale(1, "Tailscale"),
    @SerialName("cloudflare") Cloudflare(2, "Cloudflare tunnel"),
  }
}

/**
 * One pairing: this device's key, the computer's pinned key, and how to reach
 * it. Several computers can be paired; one is connected at a time.
 */
@Serializable
data class DeviceIdentity(
  val deviceId: String,
  /** This device's static X25519 keypair, standard base64. */
  val devPrivB64: String,
  val devPubB64: String,
  /** Pinned desktop static key, standard base64 (the QR carries base64url). */
  val desktopPubB64: String,
  /** Last known good gateway address. */
  val url: String,
  /** Every address this computer advertised, best first. */
  val endpoints: List<RemoteEndpoint>? = null,
  val capabilities: List<String>,
  val hostName: String? = null,
  val pairedAt: Double? = null,
  val source: Source = Source.Paired,
  /** The host's member id in the account log; null for a QR pairing. */
  val accountHostId: String? = null,
) {
  @Serializable
  enum class Source {
    @SerialName("paired") Paired,
    @SerialName("account") Account,
  }

  val id get() = deviceId
  val isAccountHost get() = source == Source.Account
  val hasControl get() = "control" in capabilities

  val keypair: NoiseKeypair?
    get() {
      val priv = ArgusBase64.decode(devPrivB64) ?: return null
      val pub = ArgusBase64.decode(devPubB64) ?: return null
      return NoiseKeypair(priv, pub)
    }

  val desktopStaticKey: ByteArray? get() = ArgusBase64.decode(desktopPubB64)

  /** The computer's own name, else the gateway host. */
  val label: String get() = hostName?.trim()?.takeIf { it.isNotEmpty() } ?: gatewayHost(url)

  /** Addresses to try, best first; the paired URL stays a candidate. */
  val candidateEndpoints: List<RemoteEndpoint>
    get() {
      val all = (endpoints ?: emptyList()).toMutableList()
      if (url.isNotEmpty() && all.none { it.url == url }) {
        val kind = inferEndpointKind(url)
        all += RemoteEndpoint(kind, url, kind.priority)
      }
      return all.sortedBy { it.priority }
    }

  companion object {
    fun gatewayHost(url: String): String = url.removePrefix("wss://").removePrefix("ws://").trimEnd('/')

    /** Tailnet (100.64.0.0/10, `*.ts.net`) is Tailscale, TLS a tunnel, the rest LAN. */
    fun inferEndpointKind(url: String): RemoteEndpoint.Kind {
      val host = runCatching { URI(url).host?.lowercase() }.getOrNull() ?: ""
      if (host.endsWith(".ts.net") || isTailnetAddress(host)) return RemoteEndpoint.Kind.Tailscale
      if (url.lowercase().startsWith("wss://")) return RemoteEndpoint.Kind.Cloudflare
      return RemoteEndpoint.Kind.Lan
    }

    fun isTailnetAddress(host: String): Boolean {
      val parts = host.split(".")
      val octets = parts.mapNotNull { it.toIntOrNull()?.takeIf { n -> n in 0..255 } }
      return parts.size == 4 && octets.size == 4 && octets[0] == 100 && octets[1] in 64..127
    }

    /** A live address replaces the remembered one of its kind; a kind not live keeps its last. */
    fun mergedEndpoints(known: List<RemoteEndpoint>?, live: List<RemoteEndpoint>): List<RemoteEndpoint> {
      val liveKinds = live.map { it.kind }.toSet()
      val kept = (known ?: emptyList()).filter { it.kind !in liveKinds }
      return (live + kept).distinctBy { it.kind }.sortedBy { it.priority }
    }

    /** One row per computer: a pairing known both ways keeps its grant and gains the account's addresses. */
    fun merging(paired: List<DeviceIdentity>, account: List<DeviceIdentity>): List<DeviceIdentity> {
      val merged = paired.toMutableList()
      for (host in account) {
        val i = merged.indexOfFirst { it.desktopPubB64 == host.desktopPubB64 }
        if (i >= 0) {
          merged[i] = merged[i].copy(
            endpoints = mergedEndpoints(merged[i].endpoints, host.endpoints ?: emptyList()),
            accountHostId = host.accountHostId,
          )
        } else {
          merged += host
        }
      }
      return merged
    }
  }
}

/** Every pairing this device holds, plus which one is connected. */
@Serializable
data class PairedHosts(val hosts: List<DeviceIdentity> = emptyList(), val activeId: String? = null) {
  val active: DeviceIdentity? get() = hosts.firstOrNull { it.deviceId == activeId }

  fun adding(identity: DeviceIdentity) = PairedHosts(
    // Re-pairing the same gateway replaces the stale grant rather than stacking.
    hosts.filterNot { it.deviceId == identity.deviceId || it.url == identity.url } + identity,
    identity.deviceId,
  )

  fun removing(deviceId: String) = PairedHosts(
    hosts.filterNot { it.deviceId == deviceId },
    activeId.takeIf { it != deviceId },
  )

  fun updating(deviceId: String, patch: (DeviceIdentity) -> DeviceIdentity) =
    copy(hosts = hosts.map { if (it.deviceId == deviceId) patch(it) else it })
}
