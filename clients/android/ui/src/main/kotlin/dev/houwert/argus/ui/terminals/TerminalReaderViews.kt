package dev.houwert.argus.ui.terminals

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.protocol.generated.RemoteTerminal
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.ListRow
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont

object TerminalLabels {
  fun title(terminal: RemoteTerminal): String = terminal.title ?: terminal.runTitle ?: "Shell"
}

/**
 * A session's terminals on the computer, for following a dev server from the
 * phone. Read-only: typing into a shell stays with the desktop. Null [terminals] is loading.
 */
@Composable
fun SessionTerminalsList(terminals: List<RemoteTerminal>?, open: (RemoteTerminal) -> Unit, modifier: Modifier = Modifier) {
  when {
    terminals == null -> Loading("Reading terminals", modifier)
    terminals.isEmpty() ->
      EmptyState(
        Icon.terminal,
        "No terminals running",
        modifier,
        body = "Shells and run commands started on the computer show up here.",
      )
    else ->
      LazyColumn(modifier.fillMaxSize()) {
        items(terminals, key = { it.id }) { terminal ->
          ListRow(
            TerminalLabels.title(terminal),
            icon = if (terminal.runTitle == null) Icon.terminal else Icon.play,
            onClick = { open(terminal) },
          )
        }
      }
  }
}

/** What a terminal has printed so far, and how it ended. */
data class TerminalOutputState(
  val text: String = "",
  val truncated: Boolean = false,
  val exitCode: Int? = null,
  /** The terminal closed on the computer while we were reading it. */
  val gone: Boolean = false,
)

/** One terminal's output in monospace, following the tail as it grows. */
@Composable
fun TerminalOutputView(state: TerminalOutputState, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val scroll = rememberScrollState()
  LaunchedEffect(state.text, state.exitCode, state.gone) { scroll.scrollTo(scroll.maxValue) }
  Box(modifier.fillMaxSize().background(theme.bg)) {
    Column(
      Modifier.fillMaxWidth().verticalScroll(scroll).padding(12.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      if (state.truncated) MutedText("Showing the most recent output.")
      SelectionContainer {
        Text(state.text, Modifier.fillMaxWidth(), style = argusFont(12, mono = true), color = theme.text)
      }
      state.exitCode?.let { Banner("Exited with code $it", tone = if (it == 0) Tone.Muted else Tone.Warning) }
      if (state.gone) Banner("This terminal has closed on the computer.", tone = Tone.Muted)
    }
  }
}
