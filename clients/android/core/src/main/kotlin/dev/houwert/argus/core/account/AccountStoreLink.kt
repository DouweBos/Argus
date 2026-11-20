package dev.houwert.argus.core.account

import dev.houwert.argus.kit.account.AccountCodec
import dev.houwert.argus.kit.account.AccountEntry
import dev.houwert.argus.kit.account.AccountEntryBuilder
import dev.houwert.argus.kit.account.AccountHead
import dev.houwert.argus.kit.account.AccountMember
import dev.houwert.argus.kit.account.AccountRequestSubject
import dev.houwert.argus.kit.account.AccountSas
import dev.houwert.argus.kit.account.AccountServiceError
import kotlinx.coroutines.CancellationException

/**
 * Adding a computer by the code it shows: claim the code, become its approver, compare the 6-digit
 * code, then write `add_host` (plus a riding window's `add_device`) in one batch.
 */
sealed interface LinkFlow {
  data object Idle : LinkFlow
  data class Working(val message: String) : LinkFlow
  /** Compare [sas] with the code on the computer before confirming. */
  data class Confirm(val sas: String, val hostName: String) : LinkFlow
  data class Done(val hostName: String) : LinkFlow
  data class Failed(val message: String) : LinkFlow
}

/** A request this device is approving: whom the code is about, and the head and code it was computed for. */
internal data class PendingLink(
  val viaPairing: Boolean,
  val requestId: String,
  val subject: AccountRequestSubject,
  val head: AccountHead,
  val sas: AccountSas,
) {
  val name: String get() = subject.member?.name ?: ""
}

/** Claim a typed `XXXX-XXXX` code and show the code to compare. [viaPairing]: a QR-paired computer handed it over. */
suspend fun AccountStore.link(code: String, viaPairing: Boolean = false) {
  if (phase.value != AccountStore.Phase.Ready) {
    _link.value = LinkFlow.Failed(AccountStoreError.NotReady.message)
    return
  }
  val normalized = AccountCodec.normalizeUserCode(code)
  if (normalized.length != 9) {
    _link.value = LinkFlow.Failed("Codes look like WDJB-MJHT.")
    return
  }
  _link.value = LinkFlow.Working("Checking the code")
  try {
    val claim = client.claim(normalized)
    if (claim.accountEmpty) {
      _link.value = LinkFlow.Failed("Finish on the computer: it becomes the first on your account.")
      return
    }
    val host = claim.subject.host
    val current = state.value
    if (current?.members?.get(host.id) != null || current?.members?.values?.any { it.member.signPub == host.signPub } == true) {
      _link.value = LinkFlow.Failed("${host.name} is already on your account.")
      return
    }
    val subject = AccountRequestSubject(host, claim.subject.device, claim.subject.proofs)
    val pending = beginApproval(claim.requestId, subject, viaPairing)
    pendingLink = pending
    _link.value = LinkFlow.Confirm(pending.sas.sas, host.name)
  } catch (e: AccountServiceError.Conflict) {
    _link.value = LinkFlow.Failed("That code is already being used by another account.")
  } catch (e: CancellationException) {
    throw e
  } catch (e: Exception) {
    _link.value = LinkFlow.Failed(AccountStore.describe(e))
  }
}

/** Become the request's approver and work out the code for its head, which must be the head this device holds. */
internal suspend fun AccountStore.beginApproval(requestId: String, subject: AccountRequestSubject, viaPairing: Boolean): PendingLink {
  val keys = vault.keys ?: throw AccountStoreError.NotReady
  val member = subject.member ?: throw AccountStoreError.NotReady
  val head = client.approve(requestId, keys.memberId)
  state.value?.let { if (it.head.seq < head.seq) refreshLog() }
  val current = state.value?.takeIf { it.head == head } ?: throw AccountStoreError.HeadMoved
  val sas = AccountSas.compute(
    AccountSas.Input(current.accountId, current.epoch, head.hash, keys.signPub, member.signPub, member.noisePub, requestId),
  )
  return PendingLink(viaPairing, requestId, subject, head, sas)
}

/**
 * Write the request's members onto the account on the head the code was computed for. Null when done;
 * when the log moved first, the new approval to compare again.
 */
internal suspend fun AccountStore.writeApproval(pending: PendingLink): PendingLink? {
  val entries = mutableListOf<AccountEntry>()
  var head = pending.head
  // A link writes its computer first, then the window riding along with it.
  for (member in listOfNotNull(pending.subject.host, pending.subject.device)) {
    val proof = pending.subject.proofs[member.id] ?: throw AccountStoreError.Keys
    val fields = if (member.role == AccountMember.Role.Host) {
      AccountEntryBuilder.Fields.AddHost(member, pending.requestId, pending.sas.commit, proof)
    } else {
      AccountEntryBuilder.Fields.AddDevice(member, pending.requestId, pending.sas.commit, proof)
    }
    val next = entry(head, fields)
    entries += next
    head = AccountHead(head.seq + 1, next.hash)
  }
  val epoch = state.value?.epoch ?: throw AccountStoreError.NotReady
  try {
    client.append(epoch, entries)
  } catch (e: AccountServiceError.Conflict) {
    refreshLog()
    return beginApproval(pending.requestId, pending.subject, pending.viaPairing)
  }
  applyOwn(entries)
  return null
}

/** "Codes match": write the computer onto the account. A moved log goes back to comparing a new code. */
suspend fun AccountStore.confirmLink() {
  val pending = pendingLink ?: return
  _link.value = LinkFlow.Working("Adding ${pending.name}")
  try {
    val again = writeApproval(pending)
    if (again != null) {
      pendingLink = again
      _link.value = LinkFlow.Confirm(again.sas.sas, again.name)
      return
    }
    pendingLink = null
    _link.value = LinkFlow.Done(pending.name)
    onEvent(AccountStore.Event.ComputerAdded(pending.viaPairing))
    refreshDirectory()
  } catch (e: CancellationException) {
    throw e
  } catch (e: Exception) {
    _link.value = LinkFlow.Failed(AccountStore.describe(e))
  }
}

/** "Codes don't match": refuse the request so the computer stops waiting. */
suspend fun AccountStore.denyLink() {
  val pending = pendingLink
  pendingLink = null
  _link.value = LinkFlow.Idle
  pending?.let { runCatching { client.deny(it.requestId) } }
}

fun AccountStore.resetLink() {
  pendingLink = null
  _link.value = LinkFlow.Idle
}
