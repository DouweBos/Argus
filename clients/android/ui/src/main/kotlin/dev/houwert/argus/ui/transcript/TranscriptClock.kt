package dev.houwert.argus.ui.transcript

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.coroutines.delay

/** Epoch milliseconds, ticking each second while [live] (`TimelineView(.periodic)`); still otherwise. */
@Composable
internal fun rememberNow(live: Boolean): Double {
  var now by remember { mutableDoubleStateOf(System.currentTimeMillis().toDouble()) }
  LaunchedEffect(live) {
    now = System.currentTimeMillis().toDouble()
    while (live) {
      delay(1000 - System.currentTimeMillis() % 1000)
      now = System.currentTimeMillis().toDouble()
    }
  }
  return now
}
