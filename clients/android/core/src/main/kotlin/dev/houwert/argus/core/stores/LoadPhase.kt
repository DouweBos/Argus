package dev.houwert.argus.core.stores

/** What a list screen shows in place of its rows, so "still loading" and "nothing there" never look the same. */
sealed interface LoadPhase {
  /** No load has answered yet. */
  data object Loading : LoadPhase
  /** Nothing to show and the last load failed. */
  data class Failed(val message: String) : LoadPhase
  /** A load answered with nothing. */
  data object Empty : LoadPhase
  /** Rows to show; a failed refresh behind them is the screen's banner. */
  data object Content : LoadPhase

  /** The rows are on screen, so any error belongs in a banner over them. */
  val showsContent: Boolean get() = this == Content

  companion object {
    /** Rows already on screen always win, so a background refresh never hides them. */
    fun of(loaded: Boolean, error: String?, isEmpty: Boolean): LoadPhase = when {
      !isEmpty -> Content
      error != null -> Failed(error)
      loaded -> Empty
      else -> Loading
    }
  }
}
