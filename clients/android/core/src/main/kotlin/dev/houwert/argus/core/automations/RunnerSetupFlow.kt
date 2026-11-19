package dev.houwert.argus.core.automations

import dev.houwert.argus.kit.protocol.generated.RemoteRunner

/** One runner's walk from "not installed" to signed in: which step runs, how it went, and what comes next. */
data class RunnerSetupFlow(
  val runnerId: String,
  val displayName: String,
  val setup: Setup,
  /** Whether the host last found its CLI. */
  val installed: Boolean,
  val step: Step = if (installed && setup.loginCommand != null) Step.Login else Step.Install,
  val source: Source = Source.Picker,
  val phase: Phase = Phase.Starting,
) {
  data class Setup(
    val installCommand: String? = null,
    val installUrl: String? = null,
    val loginCommand: String? = null,
    val logoutCommand: String? = null,
  ) {
    val canInstall: Boolean get() = installCommand != null || installUrl != null
  }

  enum class Step(val wire: String) { Install("install"), Login("login"), Logout("logout") }

  /** Where it started, so the host counts it once: the picker's, or the Accounts page's. */
  enum class Source(val wire: String) { Picker("picker"), Accounts("accounts") }

  sealed interface Phase {
    data object Starting : Phase
    data class Running(val terminalId: String) : Phase
    /** No install command: its page opened, and the user installs by hand. */
    data class OpenedPage(val url: String) : Phase
    data class Finished(val terminalId: String, val exitCode: Int) : Phase
    data class Failed(val message: String) : Phase
  }

  enum class Next { Wait, SignIn, CheckAgain, Retry, Done }

  val id: String get() = runnerId

  /** What the current step runs in its terminal. */
  val command: String?
    get() = when (step) {
      Step.Install -> setup.installCommand
      Step.Login -> setup.loginCommand
      Step.Logout -> setup.logoutCommand
    }

  val terminalId: String?
    get() = when (val p = phase) {
      is Phase.Running -> p.terminalId
      is Phase.Finished -> p.terminalId
      else -> null
    }

  val next: Next
    get() = when (val p = phase) {
      Phase.Starting, is Phase.Running -> Next.Wait
      is Phase.Failed -> Next.Retry
      is Phase.Finished -> when {
        step != Step.Install -> Next.Done
        !installed -> if (p.exitCode == 0) Next.CheckAgain else Next.Retry
        else -> if (setup.loginCommand != null) Next.SignIn else Next.Done
      }
      is Phase.OpenedPage -> if (!installed) Next.CheckAgain else if (setup.loginCommand != null) Next.SignIn else Next.Done
    }

  companion object {
    /** Null when the runner can't be set up from here. */
    fun from(runner: RemoteRunner): RunnerSetupFlow? {
      val s = runner.setup ?: return null
      val setup = Setup(s.installCommand, s.installUrl, s.loginCommand)
      if (!setup.canInstall && !runner.isAvailable) return null
      return RunnerSetupFlow(runner.id, runner.displayName, setup, runner.isAvailable)
    }
  }
}
