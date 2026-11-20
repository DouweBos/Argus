package dev.houwert.argus.core.account

import dev.houwert.argus.kit.account.AccountDeviceKeys
import dev.houwert.argus.kit.account.AccountEntryBuilder
import dev.houwert.argus.kit.account.AccountLogState

// This device's name as a setting: joins and links use it, editing it renames this device on the
// account, and a rename made from another device flows back into it.

/** This device on the account, and the Mac's bundled host: one name for both. */
internal val AccountStore.ownMemberIds: List<String> get() = listOfNotNull(vault.keys?.memberId, vault.localHostId)

fun AccountStore.isOwnMember(memberId: String): Boolean = memberId in ownMemberIds

/** The keys to join or start an account with, carrying the current name (the proof doesn't cover it). */
internal fun AccountStore.currentKeys(): AccountDeviceKeys =
  vault.keys?.copy(name = AccountDeviceKeys.memberName(deviceName())) ?: AccountDeviceKeys.generate(deviceKind, deviceName(), now().toDouble())

/** The name setting changed. The app persists it through `onNameChanged`; it goes on the account now or once reachable. */
suspend fun AccountStore.setName(raw: String, source: AccountStore.NameSource): Boolean {
  val name = AccountDeviceKeys.validatedName(raw)
  if (name == null) {
    _error.value = "Names are 1 to 64 characters on one line."
    return false
  }
  _error.value = null
  onNameChanged(name)
  onEvent(AccountStore.Event.NameChanged(source, linked = phase.value == AccountStore.Phase.Ready))
  if (vault.keys != null) {
    vault = vault.copy(pendingName = name)
    vaultStore.save(vault)
  }
  flushName()
  return true
}

/** Rename this device (and the bundled host) to the pending name. A failure leaves it pending for the next refresh. */
internal suspend fun AccountStore.flushName() {
  while (phase.value == AccountStore.Phase.Ready) {
    val name = vault.pendingName ?: return
    try {
      for (id in ownMemberIds) {
        val member = state.value?.liveMember(id)?.member ?: continue
        if (member.name == name) continue
        appendWithRetry { head -> listOf(entry(head, AccountEntryBuilder.Fields.Rename(id, name))) }
      }
    } catch (e: kotlinx.coroutines.CancellationException) {
      throw e
    } catch (e: Exception) {
      return
    }
    // Edited again meanwhile: go round with the newer name.
    if (vault.pendingName != name) continue
    vault = vault.copy(pendingName = null)
    vaultStore.save(vault)
  }
}

/** Another device renamed this one: the setting follows. Never over a local edit still pending. */
internal fun AccountStore.reflectName(prior: AccountLogState, next: AccountLogState) {
  if (vault.pendingName != null) return
  val current = deviceName()
  for (id in ownMemberIds) {
    val after = next.liveMember(id)?.member?.name ?: continue
    if (after == prior.liveMember(id)?.member?.name || after == current) continue
    onNameChanged(after)
    if (ownMemberIds.any { other -> next.liveMember(other)?.let { it.member.name != after } == true }) {
      vault = vault.copy(pendingName = after)
    }
    return
  }
}
