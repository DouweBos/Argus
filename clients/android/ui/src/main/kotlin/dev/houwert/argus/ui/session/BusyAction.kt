package dev.houwert.argus.ui.session

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch

/** Runs one host call at a time, so a row's buttons stay disabled until it lands. */
class BusyAction internal constructor(private val launch: (suspend () -> Unit) -> Unit, busyState: () -> Boolean) {
  private val read = busyState
  val busy: Boolean get() = read()
  fun run(action: suspend () -> Unit) = launch(action)
}

@Composable
fun rememberBusyAction(): BusyAction {
  val scope = rememberCoroutineScope()
  var busy by remember { mutableStateOf(false) }
  return remember {
    BusyAction(
      launch = { action ->
        if (!busy) {
          busy = true
          scope.launch {
            try { action() } finally { busy = false }
          }
        }
      },
      busyState = { busy },
    )
  }
}
