package dev.houwert.argus.core.account

import dev.houwert.argus.kit.account.AccountDeviceKeys
import dev.houwert.argus.kit.account.AccountEntryBuilder
import dev.houwert.argus.kit.account.AccountJoinRequestInfo
import dev.houwert.argus.kit.account.AccountMember
import kotlinx.coroutines.CancellationException

/** Approving a waiting computer or device from this one: the same code comparison as a typed link. */
sealed interface ApprovalFlow {
  data object Idle : ApprovalFlow
  data class Working(val message: String) : ApprovalFlow
  /** Compare [sas] with the code on [name] before confirming. */
  data class Confirm(val sas: String, val name: String, val role: AccountMember.Role) : ApprovalFlow
  data class Done(val name: String, val role: AccountMember.Role) : ApprovalFlow
  data class Failed(val message: String) : ApprovalFlow
}

/** Re-read who is waiting. Requests whose keys don't vouch for themselves, and this device's own, are never shown. */
suspend fun AccountStore.refreshRequests() {
  val keys = vault.keys
  if (phase.value != AccountStore.Phase.Ready || keys == null) {
    if (requests.value.isNotEmpty()) _requests.value = emptyList()
    return
  }
  val fetched = runCatching { client.joinRequests() }.getOrNull() ?: return
  // A code typed or handed over here is already being approved here.
  val approvingHere = setOfNotNull(pendingLink?.requestId)
  val next = fetched.filter { request ->
    if (request.requestId in approvingHere) return@filter false
    val subject = request.subject ?: return@filter false
    val member = subject.member ?: return@filter false
    subject.proven && member.signPub != keys.signPub && state.value?.members?.get(member.id) == null
  }
  if (next != requests.value) _requests.value = next
}

/** Become the approver of [request] and show the code to compare. */
suspend fun AccountStore.approve(request: AccountJoinRequestInfo) {
  val subject = request.subject
  val member = subject?.member
  if (phase.value != AccountStore.Phase.Ready || member == null || !subject.proven) {
    _approval.value = ApprovalFlow.Failed("That request can't be approved from here.")
    return
  }
  _approval.value = ApprovalFlow.Working("Checking ${member.name}")
  try {
    val pending = beginApproval(request.requestId, subject, viaPairing = false)
    pendingApproval = pending
    _approval.value = ApprovalFlow.Confirm(pending.sas.sas, member.name, member.role)
  } catch (e: CancellationException) {
    throw e
  } catch (e: Exception) {
    _approval.value = ApprovalFlow.Failed(AccountStore.describe(e))
  }
}

/** "Codes match": put it on the account. A moved head shows a new code. */
suspend fun AccountStore.confirmApproval() {
  val pending = pendingApproval ?: return
  val member = pending.subject.member ?: return
  _approval.value = ApprovalFlow.Working("Adding ${member.name}")
  try {
    val again = writeApproval(pending)
    if (again != null) {
      pendingApproval = again
      _approval.value = ApprovalFlow.Confirm(again.sas.sas, member.name, member.role)
      return
    }
    pendingApproval = null
    _approval.value = ApprovalFlow.Done(member.name, member.role)
    _requests.value = requests.value.filter { it.requestId != pending.requestId }
    onEvent(
      if (member.role == AccountMember.Role.Host) AccountStore.Event.ComputerAdded(viaPairing = false)
      else AccountStore.Event.JoinActed(AccountStore.JoinAction.Approved, AccountStore.JoinRole.Approver),
    )
    refreshDirectory()
  } catch (e: CancellationException) {
    throw e
  } catch (e: Exception) {
    _approval.value = ApprovalFlow.Failed(AccountStore.describe(e))
  }
}

/** "Codes don't match", or the request isn't expected: refuse it. */
suspend fun AccountStore.deny(requestId: String) {
  if (pendingApproval?.requestId == requestId) {
    pendingApproval = null
    _approval.value = ApprovalFlow.Idle
  }
  _requests.value = requests.value.filter { it.requestId != requestId }
  try {
    client.deny(requestId)
    onEvent(AccountStore.Event.JoinActed(AccountStore.JoinAction.Denied, AccountStore.JoinRole.Approver))
  } catch (e: CancellationException) {
    throw e
  } catch (e: Exception) {
    _error.value = AccountStore.describe(e)
  }
}

suspend fun AccountStore.denyApproval() {
  val pending = pendingApproval
  if (pending == null) {
    _approval.value = ApprovalFlow.Idle
    return
  }
  deny(pending.requestId)
}

fun AccountStore.resetApproval() {
  pendingApproval = null
  _approval.value = ApprovalFlow.Idle
}

/** Rename a device or computer on the account. This device's own name is a setting: the list edits that. */
suspend fun AccountStore.rename(memberId: String, name: String) {
  val target = state.value?.liveMember(memberId) ?: return
  if (isOwnMember(memberId)) {
    setName(name, AccountStore.NameSource.AccountList)
    return
  }
  val clean = AccountDeviceKeys.memberName(name)
  if (clean == target.member.name) return
  _error.value = null
  try {
    appendWithRetry { head -> listOf(entry(head, AccountEntryBuilder.Fields.Rename(memberId, clean))) }
    onEvent(AccountStore.Event.MemberRenamed(target.member.role))
  } catch (e: CancellationException) {
    throw e
  } catch (e: Exception) {
    _error.value = AccountStore.describe(e)
  }
}
