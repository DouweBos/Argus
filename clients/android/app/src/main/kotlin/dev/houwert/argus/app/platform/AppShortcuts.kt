package dev.houwert.argus.app.platform

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import dev.houwert.argus.app.MainActivity
import dev.houwert.argus.app.R

/**
 * The launcher's long-press shortcuts: Android's counterpart of the iPhone's App Shortcuts.
 * Dynamic rather than static so the debug build (another package) points at itself.
 */
object AppShortcuts {
  fun install(context: Context) {
    val shortcuts = listOf(
      shortcut(context, "new-agent", "Start agent", "New agent", R.drawable.ic_shortcut_new_agent) {
        Intent(context, MainActivity::class.java).setAction(LaunchRouter.ACTION_NEW_AGENT)
      },
      shortcut(context, "agents", "Agents needing me", "Agents", R.drawable.ic_shortcut_agents) { link(context, "argus://agents") },
      shortcut(context, "inbox", "Inbox", "Inbox", R.drawable.ic_shortcut_inbox) { link(context, "argus://inbox") },
      shortcut(context, "automations", "Run automation", "Automations", R.drawable.ic_shortcut_automations) {
        link(context, "argus://automations/quick")
      },
    )
    runCatching { ShortcutManagerCompat.setDynamicShortcuts(context, shortcuts) }
  }

  private fun link(context: Context, url: String) =
    Intent(Intent.ACTION_VIEW, Uri.parse(url), context, MainActivity::class.java).putExtra(LaunchRouter.EXTRA_FROM_SHORTCUT, true)

  private fun shortcut(context: Context, id: String, long: String, short: String, icon: Int, intent: () -> Intent) =
    ShortcutInfoCompat.Builder(context, id)
      .setShortLabel(short)
      .setLongLabel(long)
      .setIcon(IconCompat.createWithResource(context, icon))
      .setIntent(intent())
      .build()
}
