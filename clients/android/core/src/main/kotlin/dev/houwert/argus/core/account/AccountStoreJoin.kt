package dev.houwert.argus.core.account

import dev.houwert.argus.kit.account.AccountApproval
import dev.houwert.argus.kit.account.AccountCodec
import dev.houwert.argus.kit.account.AccountDeviceKeys
import dev.houwert.argus.kit.account.AccountEntry
import dev.houwert.argus.kit.account.AccountEntryBuilder
import dev.houwert.argus.kit.account.AccountInfo
import dev.houwert.argus.kit.account.AccountLog
import dev.houwert.argus.kit.account.AccountLogState
import dev.houwert.argus.kit.account.AccountPendingJoin
import dev.houwert.argus.kit.account.AccountRequestStatus
import dev.houwert.argus.kit.account.AccountSas
import dev.houwert.argus.kit.account.AccountServiceError
import dev.houwert.argus.kit.account.AccountSignInProvider
import dev.houwert.argus.kit.account.AccountVerifyResult
import dev.houwert.argus.kit.account.approvals
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * This device joining an account that already has devices: ask, compare a 6-digit code with the device
 * that picks it up, and adopt the log only when its `add_device` carries the code compared here.
 */
sealed interface JoinFlow {
  data object Idle : JoinFlow
  data object Requesting : JoinFlow
  /** Asked; no device has picked it up yet. */
  data object Waiting : JoinFlow
  /** Compare [sas] with the code on [approverName] before confirming. */
  data class Compare(val sas: String, val approverName: String) : JoinFlow
  /** Codes match here; waiting for [approverName] to finish. */
  data class Confirmed(val approverName: String) : JoinFlow
  /** [approverName] already added this device while it wasn't watching. Check [sas] against the code it lists. */
  data class AlreadyApproved(val sas: String, val approverName: String) : JoinFlow
  data object Denied : JoinFlow
  data object Expired : JoinFlow
  data class Failed(val message: String) : JoinFlow
}

internal data class PendingJoin(
  val requestId: String,
  val info: AccountInfo,
  val provider: AccountSignInProvider?,
  val approver: AccountRequestStatus.Approver? = null,
  val sas: AccountSas? = null,
  val confirmedCommit: String? = null,
)

/** This device's keys are on the account through an approval it didn't confirm here; adopted once its code is checked. */
internal data class ApprovedJoin(
  val entries: List<AccountEntry>,
  val state: AccountLogState,
  val approval: AccountApproval,
  val info: AccountInfo,
  val provider: AccountSignInProvider?,
)

/** Ask the account's devices to let this one in. Keys are kept, so asking again keeps the same identity. */
internal suspend fun AccountStore.requestJoin(info: AccountInfo, provider: AccountSignInProvider?) {
  stopJoin()
  _join.value = JoinFlow.Requesting
  withdrawPendingJoin()
  for (attempt in 0 until 2) {
    val keys = if (attempt == 0) currentKeys() else AccountDeviceKeys.generate(deviceKind, deviceName(), now().toDouble())
    if (vault.keys != keys) {
      vault = vault.copy(keys = keys)
      vaultStore.save(vault)
    }
    try {
      val seed = AccountCodec.fromB64(keys.signSeed) ?: throw AccountStoreError.Keys
      val proof = AccountEntryBuilder.proof(keys.member, seed)
      val ticket = client.join(keys.member, proof)
      pendingJoin = PendingJoin(ticket.requestId, info, provider)
      vault = vault.copy(pendingJoin = AccountPendingJoin(ticket.requestId, info.accountId, info.epoch))
      vaultStore.save(vault)
      _join.value = JoinFlow.Waiting
      onEvent(AccountStore.Event.JoinActed(AccountStore.JoinAction.Requested, AccountStore.JoinRole.Subject))
      startJoinPolling()
      return
    } catch (e: AccountServiceError.Conflict) {
      if (e.headSeq != null && attempt == 0) {
        // Still on the account: an earlier request was approved. Only replace these keys once they were removed.
        if (offerApprovedJoinIfMember(info, provider)) return
        continue
      }
      // The account is empty after all: this device becomes its first.
      bootstrap(provider)
      return
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      _join.value = JoinFlow.Failed(AccountStore.describe(e))
      return
    }
  }
}

/** After a relaunch: pick the persisted request back up, or file a new one. */
internal suspend fun AccountStore.continueJoin(info: AccountInfo, provider: AccountSignInProvider?) {
  val saved = vault.pendingJoin
  if (saved == null || saved.accountId != info.accountId || saved.epoch != info.epoch) {
    requestJoin(info, provider)
    return
  }
  stopJoin()
  pendingJoin = PendingJoin(saved.requestId, info, provider)
  _join.value = JoinFlow.Waiting
  startJoinPolling()
  pollJoin()
}

/** Withdraw this device's earlier request before filing a new one, so stale ones don't wait on other devices. */
private suspend fun AccountStore.withdrawPendingJoin() {
  val saved = vault.pendingJoin ?: return
  runCatching { client.deny(saved.requestId) }
  clearPendingJoin()
}

private suspend fun AccountStore.clearPendingJoin() {
  if (vault.pendingJoin == null) return
  vault = vault.copy(pendingJoin = null)
  vaultStore.save(vault)
}

/** Ask again after a denial, an expiry or an error. */
suspend fun AccountStore.retryJoin() {
  if (phase.value != AccountStore.Phase.AwaitingApproval) return
  try {
    requestJoin(client.account(), pendingJoin?.provider)
  } catch (e: CancellationException) {
    throw e
  } catch (e: Exception) {
    _join.value = JoinFlow.Failed(AccountStore.describe(e))
  }
}

internal fun AccountStore.startJoinPolling() {
  joinLoop?.cancel()
  joinLoop = scope.launch {
    while (isActive) {
      delay(joinPollIntervalMs)
      if (pendingJoin == null) return@launch
      pollJoin()
    }
  }
}

internal fun AccountStore.stopJoin() {
  joinLoop?.cancel()
  joinLoop = null
  pendingJoin = null
}

private suspend fun AccountStore.endJoin(flow: JoinFlow, action: AccountStore.JoinAction?) {
  stopJoin()
  clearPendingJoin()
  _join.value = flow
  action?.let { onEvent(AccountStore.Event.JoinActed(it, AccountStore.JoinRole.Subject)) }
}

/** One look at this device's request. */
suspend fun AccountStore.pollJoin() {
  if (phase.value != AccountStore.Phase.AwaitingApproval) return
  val pending = pendingJoin ?: return
  val status: AccountRequestStatus? = try {
    client.joinStatus(pending.requestId)
  } catch (e: AccountServiceError.Http) {
    // Gone, or filed on another account: over.
    if (e.status == 404) null else return
  } catch (e: CancellationException) {
    throw e
  } catch (e: Exception) {
    return
  }
  if (pendingJoin?.requestId != pending.requestId) return
  when (val name = status?.status ?: "expired") {
    "denied", "expired" -> {
      // An earlier request may have been approved meanwhile.
      if (offerApprovedJoinIfMember(pending.info, pending.provider)) return
      if (name == "denied") endJoin(JoinFlow.Denied, AccountStore.JoinAction.Denied)
      else endJoin(JoinFlow.Expired, AccountStore.JoinAction.Expired)
    }
    "approving", "approved" -> {
      status ?: return
      if (pendingJoin?.sas == null || pendingJoin?.approver != status.approver) showCode(status)
      if (status.status == "approved" && pendingJoin?.confirmedCommit != null) finishJoin()
    }
  }
}

/**
 * A device picked the request up. The code binds its key and the head it approves on, both checked
 * against the log, so a key or head the service swapped gives a code that doesn't match the approver's.
 */
private suspend fun AccountStore.showCode(status: AccountRequestStatus) {
  val pending = pendingJoin ?: return
  val approver = status.approver ?: return
  val head = status.head ?: return
  val keys = vault.keys ?: return
  val entries = runCatching { client.log(pending.info.epoch, -1) }.getOrNull() ?: return
  val atHead = if (head.seq in entries.indices) (AccountLog.verify(entries.take(head.seq + 1)) as? AccountVerifyResult.Ok)?.state else null
  val found = atHead?.takeIf { it.head == head }?.liveMember(approver.id)?.takeIf { it.member.signPub == approver.signPub }
  val sas = found?.let {
    runCatching {
      AccountSas.compute(AccountSas.Input(atHead.accountId, atHead.epoch, head.hash, approver.signPub, keys.signPub, keys.noisePub, pending.requestId))
    }.getOrNull()
  }
  if (found == null || sas == null) {
    endJoin(JoinFlow.Failed(AccountStoreError.UntrustedLog.message), null)
    return
  }
  // Confirmed before a relaunch: the same request and code stay confirmed.
  val confirmed = vault.joinRequestId == pending.requestId && vault.joinCommit == sas.commit
  pendingJoin = pending.copy(approver = approver, sas = sas, confirmedCommit = if (confirmed) sas.commit else null)
  _join.value = if (confirmed) JoinFlow.Confirmed(found.member.name) else JoinFlow.Compare(sas.sas, found.member.name)
}

/** "Codes match" on this device. The approver still has to confirm too. */
suspend fun AccountStore.confirmJoinCode() {
  val pending = pendingJoin ?: return
  val sas = pending.sas ?: return
  val compare = join.value as? JoinFlow.Compare ?: return
  pendingJoin = pending.copy(confirmedCommit = sas.commit)
  // Kept so a relaunch only adopts an approval that carries this code.
  vault = vault.copy(joinRequestId = pending.requestId, joinCommit = sas.commit)
  vaultStore.save(vault)
  _join.value = JoinFlow.Confirmed(compare.approverName)
  pollJoin()
}

/** "Codes don't match": refuse the request. */
suspend fun AccountStore.rejectJoinCode() {
  val pending = pendingJoin ?: return
  runCatching { client.deny(pending.requestId) }
  endJoin(JoinFlow.Denied, AccountStore.JoinAction.Denied)
}

/** Approved: adopt the log only if it adds this device with the code compared here. */
private suspend fun AccountStore.finishJoin() {
  val pending = pendingJoin ?: return
  val commit = pending.confirmedCommit ?: return
  val keys = vault.keys ?: return
  val entries = runCatching { client.log(pending.info.epoch, -1) }.getOrNull() ?: return
  when (val result = AccountLog.verify(entries)) {
    is AccountVerifyResult.Ok -> {
      if (!result.state.admits(keys.memberId, pending.requestId, commit)) {
        endJoin(JoinFlow.Failed("The approval didn't carry the code you compared, so this device didn't join."), null)
        return
      }
      adoptJoin(result.state, entries, pending.provider)
    }
    is AccountVerifyResult.Rejected -> {
      _logError.value = result.reason
      endJoin(JoinFlow.Failed(AccountStoreError.UntrustedLog.message), null)
    }
  }
}

/** Pin and adopt the log that added this device with a code confirmed here. */
private suspend fun AccountStore.adoptJoin(verified: AccountLogState, entries: List<AccountEntry>, provider: AccountSignInProvider?) {
  stopJoin()
  approvedJoin = null
  vault = vault.copy(root = verified.root, entries = entries, joinRequestId = null, joinCommit = null, pendingJoin = null)
  _state.value = verified
  _logError.value = null
  vaultStore.save(vault)
  _join.value = JoinFlow.Idle
  _phase.value = AccountStore.Phase.Ready
  publishHosts()
  onEvent(AccountStore.Event.JoinActed(AccountStore.JoinAction.Approved, AccountStore.JoinRole.Subject))
  provider?.let { onEvent(AccountStore.Event.SignedIn(it, firstDevice = false)) }
  linkLocalHostIfNeeded()
  flushName()
  refreshDirectory()
  syncPushRegistration()
}

/** Re-read the log; when this device's keys are live on it, offer that approval instead of asking again. */
private suspend fun AccountStore.offerApprovedJoinIfMember(info: AccountInfo, provider: AccountSignInProvider?): Boolean {
  val entries = runCatching { client.log(info.epoch, -1) }.getOrNull() ?: return false
  val verified = (AccountLog.verify(entries) as? AccountVerifyResult.Ok)?.state?.takeIf { ownMemberLive(it) } ?: return false
  if (admitsConfirmedJoin(verified)) adoptJoin(verified, entries, provider) else offerApprovedJoin(verified, entries, info, provider)
  return true
}

/**
 * This device's keys are live in [verified] through an approval it didn't confirm here. Show the code that
 * approval was made with, recomputed from the log, and adopt only once the user checks it against the approver.
 */
internal suspend fun AccountStore.offerApprovedJoin(verified: AccountLogState, entries: List<AccountEntry>, info: AccountInfo, provider: AccountSignInProvider?) {
  // Withdraw the request still open beside the one that was approved.
  val open = pendingJoin?.requestId ?: vault.pendingJoin?.requestId
  stopJoin()
  clearPendingJoin()
  if (open != null && open != verified.liveMember(vault.keys?.memberId ?: "")?.requestId) runCatching { client.deny(open) }
  val keys = vault.keys
  val found = keys?.let { verified.liveMember(it.memberId) }?.takeIf { it.member.noisePub == keys.noisePub }
  // A code was confirmed here for this request, and it isn't this one.
  val consistent = found != null && (vault.joinRequestId != found.requestId || vault.joinCommit == found.sasCommit)
  val approval = if (consistent) AccountLog.approvals(entries)[keys!!.memberId] else null
  val approver = approval?.let { verified.members[it.approverId] }
  if (approval == null || approver == null) {
    _join.value = JoinFlow.Failed(
      "This device is on your account through an approval it can't check. Remove it from your account on another device, then sign out here and in again.",
    )
    return
  }
  approvedJoin = ApprovedJoin(entries, verified, approval, info, provider)
  _join.value = JoinFlow.AlreadyApproved(approval.sas.sas, approver.member.name)
}

/** The code matches the one the approver lists for this device: adopt. */
suspend fun AccountStore.confirmApprovedJoin() {
  val held = approvedJoin ?: return
  val keys = vault.keys ?: return
  if (join.value !is JoinFlow.AlreadyApproved) return
  if (!held.state.admits(keys.memberId, held.approval.requestId, held.approval.sas.commit)) return
  adoptJoin(held.state, held.entries, held.provider)
}

/** "Not mine": someone else's approval put these keys on the account. Drop them and sign out. */
suspend fun AccountStore.rejectApprovedJoin() {
  if (approvedJoin == null) return
  approvedJoin = null
  onEvent(AccountStore.Event.JoinActed(AccountStore.JoinAction.Denied, AccountStore.JoinRole.Subject))
  signOut()
  _error.value = "This device signed out because its approval didn't match. Remove it from your account on your other device, then sign in again."
}

/** The code [memberId] was approved with, recomputed from the verified log. */
fun AccountStore.approvalCode(memberId: String): String? {
  val head = state.value?.head ?: return null
  if (approvalsCache?.first != head) approvalsCache = head to AccountLog.approvals(vault.entries)
  return approvalsCache?.second?.get(memberId)?.sas?.sas
}

/** A log fetched with no pin yet: adopt it only through the request and code this device confirmed. */
internal fun AccountStore.admitsConfirmedJoin(state: AccountLogState): Boolean {
  val keys = vault.keys ?: return false
  val requestId = vault.joinRequestId ?: return false
  val commit = vault.joinCommit ?: return false
  return state.admits(keys.memberId, requestId, commit)
}
