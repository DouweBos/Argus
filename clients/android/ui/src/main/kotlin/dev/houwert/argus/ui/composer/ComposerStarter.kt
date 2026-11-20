package dev.houwert.argus.ui.composer

import dev.houwert.argus.core.sessions.ComposerStart

/** Turns a composer with no agent behind it into a start composer: its pills set up the agent, and sending starts it. */
class ComposerStarter(
  /** The mode the agent starts in unless the pill picks another (a raw permission mode). */
  val defaultMode: String,
  /** Null is the runner's default. */
  val defaultModel: String? = null,
  /** A new worktree's branch is named from the text, so images alone can't send. */
  val needsText: Boolean = false,
  /** False: an empty message still starts (a Linear issue brings its own prompt). */
  val needsContent: Boolean = true,
  /** False while the start is missing a choice only the footer can make. */
  val ready: Boolean = true,
  /** The empty field's ghost text; null is the composer's own. */
  val placeholder: String? = null,
  /** Starts the agent and sends the message; false keeps the draft for another try. */
  val start: suspend (ComposerStart) -> Boolean,
) {
  companion object {
    /** The draft key a session's start composer keeps its text under. */
    fun draftKey(sessionId: String?): String = "start:${sessionId ?: "new"}"
  }
}
