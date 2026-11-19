package dev.houwert.argus.kit.net

import dev.houwert.argus.kit.crypto.ArgusBase64
import dev.houwert.argus.kit.crypto.ArgusDerive
import dev.houwert.argus.kit.crypto.NoiseCrypto
import dev.houwert.argus.kit.crypto.NoiseHandshake
import dev.houwert.argus.kit.crypto.NoiseHandshakeConfig
import dev.houwert.argus.kit.crypto.NoiseKeypair
import dev.houwert.argus.kit.crypto.NoiseRole
import dev.houwert.argus.kit.crypto.NoiseSession
import dev.houwert.argus.kit.storage.DeviceIdentity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName
import kotlinx.serialization.json.Json

/** The pairing payload a desktop shows as a QR code or short code. */
@Serializable
data class PairingPayload(
  val v: Int,
  /** Public wss:// URL of the gateway. */
  val url: String,
  /** Desktop static public key, base64url. */
  @SerialName("ds_pub") val dsPub: String,
  /** 32 bytes, base64url. Travels only in the QR, never over the wire. */
  @SerialName("pairing_secret") val pairingSecret: String,
)

@Serializable
data class PairingGrant(
  @SerialName("device_id") val deviceId: String,
  val capabilities: List<String>,
  @SerialName("host_name") val hostName: String? = null,
)

/** What this client tells the desktop it is; decides what is offered, never what is allowed. */
@Serializable
data class PairingClientInfo(
  val product: String,
  /** `desktop`, `mobile` or `web`. */
  val kind: String,
  val device: String? = null,
  val version: String? = null,
)

enum class PairingError { InvalidCode, HandshakeFailed, UnreadableGrant, Cancelled }

class PairingException(val error: PairingError) : Exception(error.name)

/**
 * Client half of pairing: Noise IKpsk1 against the gateway's `/pair`, surfaces
 * the SAS, then receives the encrypted grant once the user confirms on the desktop.
 */
class PairingClient(
  private val payload: PairingPayload,
  private val keypair: NoiseKeypair = NoiseCrypto.generateKeypair(),
  private val client: PairingClientInfo? = null,
) {
  sealed interface Event {
    /** The 6-digit code to compare with the desktop. */
    data class Sas(val code: String) : Event
    data class Paired(val identity: DeviceIdentity) : Event
    data class Failed(val error: PairingError) : Event
  }

  @OptIn(ExperimentalCoroutinesApi::class)
  fun start(): Flow<Event> = callbackFlow {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(1))
    val socket = GatewaySocket("${payload.url}/pair", scope)
    var handshake: NoiseHandshake? = null
    var session: NoiseSession? = null
    var done = false

    fun fail(error: PairingError) {
      if (done) return
      done = true
      trySend(Event.Failed(error))
      close()
    }

    scope.launch {
      socket.events.collect { event ->
        if (done) return@collect
        when (event) {
          GatewaySocket.Event.Open -> {
            val remote = ArgusBase64.decodeURL(payload.dsPub)
            val secret = ArgusBase64.decodeURL(payload.pairingSecret)
            if (remote == null || secret == null) return@collect fail(PairingError.InvalidCode)
            try {
              val hs = NoiseHandshake(NoiseHandshakeConfig(NoiseRole.Initiator, keypair, remote, ArgusDerive.pairingPSK(secret)))
              handshake = hs
              val info = client?.let { Json.encodeToString(PairingClientInfo.serializer(), it).encodeToByteArray() } ?: ByteArray(0)
              socket.send(hs.writeMessage(info))
            } catch (e: Exception) {
              fail(PairingError.HandshakeFailed)
            }
          }
          is GatewaySocket.Event.Frame -> {
            val hs = handshake ?: return@collect
            val s = session
            if (s == null) {
              try {
                hs.readMessage(event.data)
                session = hs.session()
                trySend(Event.Sas(ArgusDerive.sas(hs.handshakeHash())))
              } catch (e: Exception) {
                fail(PairingError.HandshakeFailed)
              }
              return@collect
            }
            val grant = runCatching {
              json.decodeFromString(PairingGrant.serializer(), s.decrypt(event.data).decodeToString())
            }.getOrNull()
            val remote = ArgusBase64.decodeURL(payload.dsPub)
            if (grant == null || remote == null) return@collect fail(PairingError.UnreadableGrant)
            done = true
            trySend(
              Event.Paired(
                DeviceIdentity(
                  deviceId = grant.deviceId,
                  devPrivB64 = ArgusBase64.encode(keypair.priv),
                  devPubB64 = ArgusBase64.encode(keypair.pub),
                  // Re-encoded from base64url so everything downstream sees one form.
                  desktopPubB64 = ArgusBase64.encode(remote),
                  url = payload.url,
                  capabilities = grant.capabilities,
                  hostName = grant.hostName,
                  pairedAt = System.currentTimeMillis().toDouble(),
                ),
              ),
            )
            close()
          }
          GatewaySocket.Event.Closed -> Unit
        }
      }
    }
    socket.connect()
    awaitClose {
      socket.close()
      scope.cancel()
    }
  }

  companion object {
    private val json = Json { ignoreUnknownKeys = true }

    /** A scanned QR string or a pasted base64url pairing code. */
    fun parse(input: String): PairingPayload {
      val trimmed = input.trim()
      val text = if (trimmed.startsWith("{")) trimmed else ArgusBase64.decodeURL(trimmed)?.decodeToString()
      val payload = text?.let { runCatching { json.decodeFromString(PairingPayload.serializer(), it) }.getOrNull() }
      if (payload == null || payload.v != 1 || payload.url.isEmpty() || payload.dsPub.isEmpty()) {
        throw PairingException(PairingError.InvalidCode)
      }
      return payload
    }
  }
}
