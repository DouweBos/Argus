package dev.houwert.argus.core.account

import dev.houwert.argus.kit.account.AccountCachedPresence
import dev.houwert.argus.kit.account.AccountEntry
import dev.houwert.argus.kit.account.AccountEntryBuilder
import dev.houwert.argus.kit.account.AccountHead
import dev.houwert.argus.kit.account.AccountLog
import dev.houwert.argus.kit.account.AccountLogState
import dev.houwert.argus.kit.account.AccountMember
import dev.houwert.argus.kit.account.AccountPresence
import dev.houwert.argus.kit.account.AccountServiceError
import dev.houwert.argus.kit.account.AccountVerifyResult
import dev.houwert.argus.kit.storage.DeviceIdentity
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** Fetch and verify entries past the head; a log that doesn't verify is refused whole. False once off the account. */
internal suspend fun AccountStore.refreshLog(): Boolean {
  val current = state.value
  val root = vault.root
  if (current == null || root == null) return phase.value == AccountStore.Phase.Ready
  val fresh = try {
    client.log(current.epoch, current.head.seq)
  } catch (e: CancellationException) {
    throw e
  } catch (e: Exception) {
    return !handleMemberError(e)
  }
  if (fresh.isEmpty()) return true
  when (val result = AccountLog.verify(fresh, root, current)) {
    is AccountVerifyResult.Ok -> {
      _logError.value = null
      adopt(result.state, fresh)
    }
    is AccountVerifyResult.Rejected -> _logError.value = result.reason
  }
  return phase.value == AccountStore.Phase.Ready
}

private suspend fun AccountStore.adopt(verified: AccountLogState, entries: List<AccountEntry>) {
  val prior = state.value
  _state.value = verified
  vault = vault.copy(entries = vault.entries + entries)
  if (!ownMemberLive(verified)) {
    // Another device removed this one.
    dropRemoved()
    return
  }
  prior?.let { reflectName(it, verified) }
  vaultStore.save(vault)
  publishHosts()
}

/** Sign entries against the current head and append them; when another device moved the head, catch up and sign again, once. */
internal suspend fun AccountStore.appendWithRetry(apply: Boolean = true, build: (AccountHead) -> List<AccountEntry>) {
  for (attempt in 0 until 2) {
    val current = state.value ?: throw AccountStoreError.NotReady
    val entries = build(current.head)
    try {
      client.append(current.epoch, entries)
    } catch (e: AccountServiceError.Conflict) {
      if (attempt == 0) {
        refreshLog()
        continue
      }
      throw e
    }
    if (apply) applyOwn(entries)
    return
  }
  throw AccountStoreError.HeadMoved
}

/** Entries this device just appended, folded into the verified state. */
internal suspend fun AccountStore.applyOwn(entries: List<AccountEntry>) {
  val current = state.value ?: throw AccountStoreError.UntrustedLog
  val verified = (AccountLog.verify(entries, vault.root, current) as? AccountVerifyResult.Ok)?.state ?: throw AccountStoreError.UntrustedLog
  adopt(verified, entries)
  if (phase.value == AccountStore.Phase.Ready) onLogAppended()
}

internal fun AccountStore.entry(head: AccountHead, fields: AccountEntryBuilder.Fields): AccountEntry {
  val current = state.value ?: throw AccountStoreError.NotReady
  val signer = vault.keys?.signer ?: throw AccountStoreError.NotReady
  return AccountEntryBuilder.make(current.accountId, current.epoch, head, nowMs(), signer, fields)
}

/** Verified presence for every live host; online is recomputed against now even when the fetch fails. */
suspend fun AccountStore.refreshDirectory() {
  if (phase.value != AccountStore.Phase.Ready) return
  val current = state.value ?: return
  val records = runCatching { client.directory() }.getOrNull()
  if (records == null) {
    publishHosts()
    return
  }
  var changed = false
  val presence = vault.presence.toMutableMap()
  for (record in records) {
    val verified = AccountLog.verifyPresence(record, current) ?: continue
    val held = presence[record.hostId]
    if (held != null && held.ts > verified.ts) continue
    val cached = AccountCachedPresence(verified.ts, record.lastSeen, verified.endpoints)
    if (held != cached) {
      presence[record.hostId] = cached
      changed = true
    }
  }
  if (changed) {
    vault = vault.copy(presence = presence)
    vaultStore.save(vault)
  }
  publishHosts()
}

internal fun AccountStore.publishHosts() {
  val members = state.value?.liveMembers?.filter { it.role == AccountMember.Role.Host } ?: emptyList()
  val next = members.map { member ->
    val presence = vault.presence[member.id]
    AccountStore.Host(
      member, presence?.endpoints ?: emptyList(), presence?.lastSeen,
      AccountPresence.isOnline(presence?.lastSeen, now().toDouble()), member.id == vault.localHostId,
    )
  }
  val previous = hosts.value
  val identitiesChanged = next.map { it.member } != previous.map { it.member } || next.map { it.endpoints } != previous.map { it.endpoints }
  if (next != previous) _hosts.value = next
  if (identitiesChanged) onHostsChanged(hostIdentities)
  // A host joined or left: seal this device's push key for the new set.
  if (pushToken != null && next.map { it.member } != previous.map { it.member }) scope.launch { syncPushRegistration() }
}

/** Account hosts as connectable identities: the log's Noise key pinned, this device's account-wide key to dial with. */
val AccountStore.hostIdentities: List<DeviceIdentity>
  get() {
    val keys = vault.keys ?: return emptyList()
    return hosts.value.filter { !it.isLocal }.map { host ->
      val endpoints = host.endpoints.sortedBy { it.priority }
      DeviceIdentity(
        deviceId = "account:${host.id}", devPrivB64 = keys.noisePriv, devPubB64 = keys.noisePub,
        desktopPubB64 = host.member.noisePub, url = endpoints.firstOrNull()?.url ?: "", endpoints = endpoints,
        capabilities = emptyList(), hostName = host.name, source = DeviceIdentity.Source.Account, accountHostId = host.id,
      )
    }
  }

/** Take a host or device off the account. */
suspend fun AccountStore.remove(memberId: String) {
  val target = state.value?.liveMember(memberId) ?: return
  _error.value = null
  try {
    appendWithRetry { head -> listOf(entry(head, AccountEntryBuilder.Fields.Revoke(memberId, "removed"))) }
    vault = vault.copy(presence = vault.presence - memberId)
    publishHosts()
    onEvent(AccountStore.Event.MemberRemoved(target.member.role))
  } catch (e: CancellationException) {
    throw e
  } catch (e: Exception) {
    _error.value = AccountStore.describe(e)
  }
}
