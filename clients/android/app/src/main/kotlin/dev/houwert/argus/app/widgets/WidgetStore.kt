package dev.houwert.argus.app.widgets

import android.content.Context
import dev.houwert.argus.kit.widgets.WidgetSnapshot
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * The snapshot on disk. The app, the messaging service and the widgets all run in
 * this process, so plain shared preferences reach every one of them.
 */
object WidgetStore {
  private const val FILE = "argus.widgets"
  private const val KEY = "snapshot"

  /** Live for an open widget session, which otherwise keeps the snapshot it started with. */
  private var changes: MutableStateFlow<WidgetSnapshot>? = null

  fun load(context: Context): WidgetSnapshot =
    WidgetSnapshot.decode(context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(KEY, null))

  @Synchronized
  fun flow(context: Context): StateFlow<WidgetSnapshot> = changes ?: MutableStateFlow(load(context)).also { changes = it }

  /** Load, change, save; true when [body] changed it. */
  @Synchronized
  fun update(context: Context, body: (WidgetSnapshot) -> WidgetSnapshot): Boolean {
    val before = load(context)
    val after = body(before)
    if (after == before) return false
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(KEY, WidgetSnapshot.encode(after)).apply()
    changes?.value = after
    return true
  }
}
