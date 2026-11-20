package dev.houwert.argus.ui.composer

import dev.houwert.argus.kit.protocol.generated.RemoteAgentCapabilities
import dev.houwert.argus.kit.protocol.generated.RemoteModelInfo
import dev.houwert.argus.kit.protocol.generated.RemotePermissionMode
import dev.houwert.argus.kit.protocol.generated.RemoteProject

/** The permission-mode vocabulary the desktop uses. */
object ComposerPermissionMode {
  /** Shift+Tab order, Claude Code's own convention; also the picker's. */
  val order = listOf(RemotePermissionMode.auto, RemotePermissionMode.ask, RemotePermissionMode.plan, RemotePermissionMode.review)

  /** Canonical, Claude-native or missing → the mode the picker shows. `trusted` can't be set here and reads as auto. */
  fun canonical(mode: String?): RemotePermissionMode = when (mode) {
    "default" -> RemotePermissionMode.ask
    "acceptEdits" -> RemotePermissionMode.review
    else -> order.firstOrNull { it.rawValue == mode } ?: RemotePermissionMode.auto
  }

  fun label(mode: RemotePermissionMode): String = when (mode) {
    RemotePermissionMode.ask -> "Ask"
    RemotePermissionMode.plan -> "Plan"
    RemotePermissionMode.review -> "Accept edits"
    else -> "Auto"
  }

  fun description(mode: RemotePermissionMode): String = when (mode) {
    RemotePermissionMode.ask -> "Ask before edits, commands, and other writes."
    RemotePermissionMode.plan -> "Read-only: agent must present a plan before any writes."
    RemotePermissionMode.review -> "Auto-approve file edits; still ask for shell + network."
    else -> "Smart classifier auto-approves safe actions; risky ones still ask."
  }

  fun next(after: RemotePermissionMode): RemotePermissionMode {
    val index = order.indexOf(after)
    return if (index < 0) RemotePermissionMode.auto else order[(index + 1) % order.size]
  }
}

/** The effort picker's levels. */
object ComposerEffort {
  const val ULTRACODE = "ultracode"

  /** The model's levels, plus the synthetic `ultracode` wherever xhigh is. Empty hides the picker. */
  fun levels(model: RemoteModelInfo?): List<String> {
    val levels = model?.takeIf { it.supportsEffort == true }?.supportedEffortLevels
    if (levels.isNullOrEmpty()) return emptyList()
    return if ("xhigh" in levels) levels + ULTRACODE else levels
  }

  fun label(level: String?): String = when (level) {
    null -> "Default"
    "low" -> "Low"
    "medium" -> "Medium"
    "high" -> "High"
    "xhigh" -> "Extra high"
    "max" -> "Max"
    ULTRACODE -> "Ultracode"
    else -> level
  }
}

/** What the composer's model and project pickers offer. */
object ComposerOptions {
  /** The agent's own models; with none reported, any agent's on the computer. */
  fun models(own: List<RemoteModelInfo>, byAgent: Map<String, RemoteAgentCapabilities>): List<RemoteModelInfo> {
    if (own.isNotEmpty()) return own
    return byAgent.entries.sortedBy { it.key }.firstOrNull { it.value.models.isNotEmpty() }?.value?.models.orEmpty()
  }

  /** The picked model's entry; null is the CLI default. */
  fun current(picked: String?, models: List<RemoteModelInfo>): RemoteModelInfo? =
    models.firstOrNull { it.value == (picked ?: "default") } ?: models.firstOrNull()

  /** Every project but the session's own: linking it to itself adds nothing. */
  fun linkable(projects: List<RemoteProject>, ownRepoRoot: String?): List<RemoteProject> =
    projects.filter { it.repoRoot != ownRepoRoot }
}

/** What a key press in the composer is. */
sealed interface ComposerKey {
  data class Return(val shift: Boolean) : ComposerKey
  data class Tab(val shift: Boolean) : ComposerKey
  data object Up : ComposerKey
  data object Down : ComposerKey
  data object Escape : ComposerKey
  /** Ctrl/Cmd+. — "cancel". */
  data object CommandPeriod : ComposerKey
}

sealed interface ComposerKeyAction {
  /** Let the text field handle it (newline, caret movement, tab). */
  data object PassThrough : ComposerKeyAction
  /** Eat it. */
  data object Ignore : ComposerKeyAction
  data object Send : ComposerKeyAction
  data class MenuMove(val delta: Int) : ComposerKeyAction
  data object MenuAccept : ComposerKeyAction
  data object MenuDismiss : ComposerKeyAction
  data object CyclePermissionMode : ComposerKeyAction
  data object Interrupt : ComposerKeyAction
  /** Tab takes the suggested reply. */
  data object AcceptFollowUp : ComposerKeyAction
}

/** Pure, so the bindings are testable. */
object ComposerKeymap {
  /**
   * Return sends, Shift+Return is a newline. An open menu takes arrows, Tab, Return and Esc first,
   * then Tab takes a suggested reply when there is one.
   */
  fun action(key: ComposerKey, menuOpen: Boolean, isRunning: Boolean, hasFollowUp: Boolean = false): ComposerKeyAction {
    if (menuOpen) {
      when (key) {
        ComposerKey.Up -> return ComposerKeyAction.MenuMove(-1)
        ComposerKey.Down -> return ComposerKeyAction.MenuMove(1)
        ComposerKey.Tab(false), ComposerKey.Return(false) -> return ComposerKeyAction.MenuAccept
        ComposerKey.Escape -> return ComposerKeyAction.MenuDismiss
        else -> Unit
      }
    }
    return when (key) {
      ComposerKey.Return(false) -> ComposerKeyAction.Send
      ComposerKey.Tab(false) -> if (hasFollowUp) ComposerKeyAction.AcceptFollowUp else ComposerKeyAction.PassThrough
      ComposerKey.Tab(true) -> ComposerKeyAction.CyclePermissionMode
      ComposerKey.CommandPeriod -> if (isRunning) ComposerKeyAction.Interrupt else ComposerKeyAction.Ignore
      ComposerKey.Escape -> ComposerKeyAction.Ignore
      else -> ComposerKeyAction.PassThrough
    }
  }

  /** Menus clamp rather than wrap. */
  fun move(index: Int, by: Int, count: Int): Int = if (count <= 0) 0 else (index + by).coerceIn(0, count - 1)
}
