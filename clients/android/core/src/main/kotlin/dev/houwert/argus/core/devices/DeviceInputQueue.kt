package dev.houwert.argus.core.devices

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Sends device input one request at a time, in order. A coroutine per event let
 * a tap's up overtake its down, which the device read as a long press.
 */
class DeviceInputQueue(private val scope: CoroutineScope) {
  /** [coalesceKey] marks a drag sample: one still waiting is replaced by the next. */
  class Item(val coalesceKey: String? = null, val send: suspend () -> Unit)

  private val pending = ArrayDeque<Item>()
  private var draining = false

  fun enqueue(item: Item) {
    val last = pending.lastOrNull()
    if (item.coalesceKey != null && last?.coalesceKey == item.coalesceKey) pending[pending.size - 1] = item
    else pending.addLast(item)
    if (draining) return
    draining = true
    scope.launch {
      try {
        while (pending.isNotEmpty()) pending.removeFirst().send()
      } finally {
        draining = false
      }
    }
  }
}
