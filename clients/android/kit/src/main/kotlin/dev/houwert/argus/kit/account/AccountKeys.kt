package dev.houwert.argus.kit.account

import dev.houwert.argus.kit.crypto.NoiseCrypto
import dev.houwert.argus.kit.crypto.NoiseKeypair
import dev.houwert.argus.kit.storage.Keystore
import dev.houwert.argus.kit.storage.RemoteEndpoint
import java.util.UUID
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** This install's account identity: one Ed25519 key that signs log entries, one X25519 Noise key it dials every host with. */
@Serializable
data class AccountDeviceKeys(
  val memberId: String,
  /** The 32-byte Ed25519 seed, standard base64. */
  val signSeed: String,
  val signPub: String,
  val noisePriv: String,
  val noisePub: String,
  /** The wire device kind, see [AccountBody.DEVICE_KINDS]. */
  val kind: String,
  val name: String,
  val createdAt: Double,
) {
  val member: AccountMember get() = AccountMember.device(memberId, kind, signPub, noisePub, name, createdAt)

  val signer: AccountSigner? get() = AccountCodec.fromB64(signSeed)?.let { AccountSigner(memberId, it) }

  val noiseKeypair: NoiseKeypair?
    get() {
      val priv = AccountCodec.fromB64(noisePriv) ?: return null
      val pub = AccountCodec.fromB64(noisePub) ?: return null
      return NoiseKeypair(priv, pub)
    }

  companion object {
    fun generate(kind: String, name: String, nowMs: Double = System.currentTimeMillis().toDouble()): AccountDeviceKeys {
      val seed = AccountCodec.randomSeed()
      val noise = NoiseCrypto.generateKeypair()
      return AccountDeviceKeys(
        memberId = UUID.randomUUID().toString().lowercase(),
        signSeed = AccountCodec.b64(seed),
        signPub = AccountCodec.signingPublicKey(seed),
        noisePriv = AccountCodec.b64(noise.priv),
        noisePub = AccountCodec.b64(noise.pub),
        kind = kind,
        name = memberName(name),
        createdAt = Math.rint(nowMs),
      )
    }

    /** A device name the log accepts: 1–64 UTF-16 units, no control characters. */
    fun memberName(raw: String): String {
      var name = buildString { raw.codePoints().filter { it >= 0x20 && it != 0x7f }.forEach { appendCodePoint(it) } }
        .trim { it == ' ' || it == '\t' || Character.isSpaceChar(it) }
      while (name.length > 64) name = name.substring(0, name.offsetByCodePoints(name.length, -1))
      return name.ifEmpty { "Device" }
    }

    /** A name typed into a "Name" setting: trimmed, then valid, else null. Mirrors the TS `normalizeMemberName`. */
    fun validatedName(raw: String): String? = raw.trim().takeIf { AccountBody.validName(it) }
  }
}

/** Where a host was last seen, kept so an offline host still has addresses to try. */
@Serializable
data class AccountCachedPresence(val ts: Double, val lastSeen: Double, val endpoints: List<RemoteEndpoint>)

/** A join request this device filed and hasn't seen settled yet. */
@Serializable
data class AccountPendingJoin(val requestId: String, val accountId: String, val epoch: Int)

/** Everything account-related this device keeps between launches. */
@Serializable
data class AccountVault(
  val keys: AccountDeviceKeys? = null,
  /** The account this device trusts, pinned at genesis or on resume. */
  val root: AccountRoot? = null,
  /** The verified log, so a launch re-verifies offline and fetches only what's new. */
  val entries: List<AccountEntry> = emptyList(),
  val presence: Map<String, AccountCachedPresence> = emptyMap(),
  /** The Mac app's bundled host, once linked; never set on a phone. */
  val localHostId: String? = null,
  /** The join request whose code this device confirmed, and that code's commit. */
  val joinRequestId: String? = null,
  val joinCommit: String? = null,
  /** The join request this device is waiting on, so a relaunch resumes it. */
  val pendingJoin: AccountPendingJoin? = null,
  /** A name set here that isn't on the account yet (offline, or mid-join). */
  val pendingName: String? = null,
  /** The signed-in person as last seen, so a member whose sign-in session lapsed still shows whose account it is. */
  val profile: dev.houwert.argus.kit.account.AccountProfile? = null,
) {
  companion object {
    val EMPTY = AccountVault()
  }
}

interface AccountVaultStore {
  suspend fun load(): AccountVault
  suspend fun save(vault: AccountVault)
}

/** The vault in the secret store, beside the pairings: this device only, never synced. */
class KeystoreAccountVault(private val keystore: Keystore, private val item: String = "argus.account") : AccountVaultStore {
  private val json = Json { ignoreUnknownKeys = true }

  override suspend fun load(): AccountVault {
    val data = keystore.readItem(item) ?: return AccountVault.EMPTY
    return runCatching { json.decodeFromString(AccountVault.serializer(), data.decodeToString()) }.getOrDefault(AccountVault.EMPTY)
  }

  override suspend fun save(vault: AccountVault) {
    if (vault == AccountVault.EMPTY) return keystore.deleteItem(item)
    keystore.writeItem(json.encodeToString(AccountVault.serializer(), vault).encodeToByteArray(), item)
  }
}

/** For tests and previews. */
class MemoryAccountVault(initial: AccountVault = AccountVault.EMPTY) : AccountVaultStore {
  @Volatile var vault: AccountVault = initial
    private set

  override suspend fun load() = vault
  override suspend fun save(vault: AccountVault) { this.vault = vault }
}
