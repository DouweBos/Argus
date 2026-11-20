package dev.houwert.argus.core.terminals

/**
 * Stitches a terminal's replayed scrollback onto its live `terminal.data`
 * events, so a view that (re)attaches shows every byte exactly once. Live
 * events are held until the replay lands; its response `seq` splits them.
 */
class TerminalFeed {
  sealed interface Output {
    /** Start over: the view's contents are about to be replayed. */
    data object Reset : Output
    class Data(val bytes: ByteArray) : Output
    data class Exit(val code: Int) : Output
  }

  sealed interface Live {
    class Data(val bytes: ByteArray) : Live
    data class Exit(val code: Int) : Live
  }

  /** Null while a replay is in flight. */
  private var replaySeq: Int? = null
  private val held = mutableListOf<Pair<Int, Live>>()

  val awaitingReplay: Boolean get() = replaySeq == null

  fun beginReplay() {
    replaySeq = null
    held.clear()
  }

  fun live(event: Live, seq: Int): List<Output> {
    val split = replaySeq ?: run {
      held += seq to event
      return emptyList()
    }
    // Delivered late, but sent before the replay: already shown.
    return if (seq > split) listOf(output(event)) else emptyList()
  }

  fun replay(data: ByteArray, exitCode: Int?, seq: Int): List<Output> {
    replaySeq = seq
    val out = mutableListOf<Output>(Output.Reset)
    if (data.isNotEmpty()) out += Output.Data(data)
    if (exitCode != null) out += Output.Exit(exitCode)
    out += held.filter { it.first > seq }.map { output(it.second) }
    held.clear()
    return out
  }

  private fun output(event: Live): Output = when (event) {
    is Live.Data -> Output.Data(event.bytes)
    is Live.Exit -> Output.Exit(event.code)
  }
}
