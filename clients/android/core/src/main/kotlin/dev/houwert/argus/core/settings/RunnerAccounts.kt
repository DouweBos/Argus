package dev.houwert.argus.core.settings

import dev.houwert.argus.kit.protocol.generated.RunnerAccount
import dev.houwert.argus.kit.protocol.generated.RunnerAccountStatus

/** What the Accounts page shows for a runner besides Claude Code. */
enum class RunnerAccountAction(val title: String) { Install("Install"), SignIn("Sign In"), SignOut("Sign Out"), CheckAgain("Check Again") }

enum class RunnerAccountTone { Success, Warning, Muted }

val RunnerAccount.isInstalled: Boolean get() = status != RunnerAccountStatus.notInstalled

val RunnerAccount.statusLabel: String
  get() = when (status) {
    RunnerAccountStatus.signedIn -> "Signed in"
    RunnerAccountStatus.signedOut -> "Not signed in"
    RunnerAccountStatus.notInstalled -> "Not installed"
    else -> if (canProbe) "Status unknown" else "Can't check sign-in"
  }

val RunnerAccount.tone: RunnerAccountTone
  get() = when (status) {
    RunnerAccountStatus.signedIn -> RunnerAccountTone.Success
    RunnerAccountStatus.signedOut -> RunnerAccountTone.Warning
    else -> RunnerAccountTone.Muted
  }

/** The account, then the status, as the row's second line. */
val RunnerAccount.subtitle: String get() = listOfNotNull(account, statusLabel).joinToString(" · ")

private val RunnerAccount.canInstall get() = (setup?.installCommand ?: setup?.installUrl) != null

/** The one action the row leads with; the rest go in its menu. */
val RunnerAccount.primaryAction: RunnerAccountAction?
  get() = when (status) {
    RunnerAccountStatus.notInstalled -> if (canInstall) RunnerAccountAction.Install else null
    RunnerAccountStatus.signedIn -> null
    else -> if (setup?.loginCommand != null) RunnerAccountAction.SignIn else null
  }

/** Everything this runner offers, in menu order. */
val RunnerAccount.actions: List<RunnerAccountAction>
  get() = buildList {
    if (!isInstalled && canInstall) add(RunnerAccountAction.Install)
    if (isInstalled && status != RunnerAccountStatus.signedIn && setup?.loginCommand != null) add(RunnerAccountAction.SignIn)
    if (isInstalled && status != RunnerAccountStatus.signedOut && setup?.logoutCommand != null) add(RunnerAccountAction.SignOut)
    add(RunnerAccountAction.CheckAgain)
  }

/** Installed runners always shown; missing ones folded once there are enough to crowd the list. */
class RunnerAccountSections(accounts: List<RunnerAccount>) {
  val installed = accounts.filter { it.isInstalled }
  val missing = accounts.filterNot { it.isInstalled }
  val collapsesMissing = missing.size >= COLLAPSE_THRESHOLD

  companion object {
    const val COLLAPSE_THRESHOLD = 4
  }
}
