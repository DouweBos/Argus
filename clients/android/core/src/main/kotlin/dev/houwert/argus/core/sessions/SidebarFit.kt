package dev.houwert.argus.core.sessions

/**
 * When the app sidebar gives way so the content beside it keeps its room: hidden while cramped,
 * back once there's space unless the user hid it themselves.
 */
object SidebarFit {
  data class State(
    val shown: Boolean,
    /** Hidden to make room, not by the user. */
    val autoHidden: Boolean,
  )

  fun fit(state: State, cramped: Boolean): State = when {
    cramped && state.shown -> State(shown = false, autoHidden = true)
    !cramped && state.autoHidden -> State(shown = true, autoHidden = false)
    else -> state
  }

  /** A chat with a side panel beside it, at their minimums, and the sidebar next to both don't fit in [width]. */
  fun panelCramped(width: Double, sidebar: Double, panel: Double, chat: Double): Boolean =
    width > 0 && width < sidebar + panel + chat
}
