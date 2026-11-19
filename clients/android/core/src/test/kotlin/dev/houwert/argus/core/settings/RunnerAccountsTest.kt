package dev.houwert.argus.core.settings

import dev.houwert.argus.kit.protocol.generated.RunnerAccount
import dev.houwert.argus.kit.protocol.generated.RunnerAccountStatus
import dev.houwert.argus.kit.protocol.generated.RunnerSetup
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RunnerAccountsTest {
  private fun account(status: RunnerAccountStatus, logout: String? = "x logout", canProbe: Boolean = true) =
    RunnerAccount(
      id = "x", displayName = "X", isCustom = false, status = status, canProbe = canProbe,
      setup = RunnerSetup(installCommand = "install x", loginCommand = "x login", logoutCommand = logout),
    )

  @Test fun offersWhatEachStatusAllows() {
    assertEquals(listOf(RunnerAccountAction.Install, RunnerAccountAction.CheckAgain), account(RunnerAccountStatus.notInstalled).actions)
    assertEquals(RunnerAccountAction.Install, account(RunnerAccountStatus.notInstalled).primaryAction)
    assertEquals(listOf(RunnerAccountAction.SignIn, RunnerAccountAction.CheckAgain), account(RunnerAccountStatus.signedOut).actions)
    assertEquals(RunnerAccountAction.SignIn, account(RunnerAccountStatus.signedOut).primaryAction)
    assertEquals(listOf(RunnerAccountAction.SignOut, RunnerAccountAction.CheckAgain), account(RunnerAccountStatus.signedIn).actions)
    assertEquals(listOf(RunnerAccountAction.CheckAgain), account(RunnerAccountStatus.signedIn, logout = null).actions)
    assertEquals(listOf(RunnerAccountAction.SignIn, RunnerAccountAction.SignOut, RunnerAccountAction.CheckAgain), account(RunnerAccountStatus.unknown).actions)
  }

  @Test fun saysWhyStatusIsUnknown() {
    assertEquals("Status unknown", account(RunnerAccountStatus.unknown).statusLabel)
    assertEquals("Can't check sign-in", account(RunnerAccountStatus.unknown, canProbe = false).statusLabel)
  }

  @Test fun foldsMissingRunnersOnceThereAreMany() {
    val few = RunnerAccountSections(listOf(account(RunnerAccountStatus.signedIn), account(RunnerAccountStatus.notInstalled)))
    assertEquals(1, few.installed.size)
    assertFalse(few.collapsesMissing)
    assertTrue(RunnerAccountSections(List(4) { account(RunnerAccountStatus.notInstalled) }).collapsesMissing)
  }
}
