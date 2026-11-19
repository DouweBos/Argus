package dev.houwert.argus.core.account

import dev.houwert.argus.core.support.FakeAccountAuth
import dev.houwert.argus.core.support.FakeAccountService
import dev.houwert.argus.kit.account.AccountCodec
import dev.houwert.argus.kit.account.AccountDeviceKeys
import dev.houwert.argus.kit.account.AccountEntry
import dev.houwert.argus.kit.account.AccountEntryBuilder
import dev.houwert.argus.kit.account.AccountHead
import dev.houwert.argus.kit.account.AccountMember
import dev.houwert.argus.kit.account.AccountSigner
import dev.houwert.argus.kit.account.AccountVault
import dev.houwert.argus.kit.account.MemoryAccountVault
import kotlinx.coroutines.CoroutineScope

/** A member with a deterministic Ed25519 key. */
class TestKey(byte: Int) {
  val id = "00000000-0000-4000-8000-0000000000%02d".format(byte)
  val seed = ByteArray(32) { byte.toByte() }
  val signPub get() = AccountCodec.signingPublicKey(seed)
  val noisePub: String = AccountCodec.b64(ByteArray(32) { (byte + 100).toByte() })
  val signer get() = AccountSigner(id, seed)

  fun host(name: String) = AccountMember(id, AccountMember.Role.Host, platform = "darwin", signPub = signPub, noisePub = noisePub, name = name, createdAt = 1.0)
  fun device(name: String, kind: String = "ios") = AccountMember.device(id, kind, signPub, noisePub, name, 1.0)
  fun proof(member: AccountMember) = AccountEntryBuilder.proof(member, seed)

  val deviceKeys get() = AccountDeviceKeys(
    id, AccountCodec.b64(seed), signPub, AccountCodec.b64(ByteArray(32) { 9 }), noisePub, "ios", "Phone", 1.0,
  )
}

const val BASE_URL = "https://example.test/argus/account/v1"
const val NEVER = 3_600_000L

fun makeStore(
  scope: CoroutineScope, service: FakeAccountService, auth: FakeAccountAuth, vault: AccountVault = AccountVault.EMPTY,
  kind: String = "ios", name: () -> String = { "Phone" }, localHost: AccountLocalHostLinking? = null,
  now: () -> Long = System::currentTimeMillis,
): Pair<AccountStore, MemoryAccountVault> {
  val memory = MemoryAccountVault(vault)
  return AccountStore(scope, auth, memory, kind, name, localHost, BASE_URL, service.http, now, NEVER) to memory
}

fun FakeAccountService.genesis(key: TestKey, name: String = "Other", epoch: Int = 0, ts: Long = AccountEntryBuilder.nowMs()): AccountEntry =
  AccountEntryBuilder.make(accountId, epoch, null, ts, key.signer, AccountEntryBuilder.Fields.Genesis(key.device(name)))

/** Append outside the API, as another device would. */
fun FakeAccountService.append(fields: AccountEntryBuilder.Fields, signer: AccountSigner) {
  val head = if (log.isEmpty()) null else AccountHead(log.size - 1, headHash)
  inject(AccountEntryBuilder.make(accountId, 0, head, signer = signer, fields = fields))
}

fun AccountStore.recordEvents(): MutableList<AccountStore.Event> = mutableListOf<AccountStore.Event>().also { list -> onEvent = { list += it } }
