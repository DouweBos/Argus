package dev.houwert.argus.app.screens.teammates

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.stores.promote
import dev.houwert.argus.core.teammates.TeammateText
import dev.houwert.argus.kit.protocol.generated.RemoteAutomation
import dev.houwert.argus.kit.protocol.generated.Teammate
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.ListRow
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.teammates.TeammateAvatar
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.launch

/**
 * The teammate an automation is a duty of, linked; a standalone one can be moved to a new
 * teammate or an existing one with control. Absent on a computer without teammates.
 */
@Composable
fun AutomationTeammateSection(automation: RemoteAutomation, hasControl: Boolean, ready: Boolean) {
  val app = LocalAppStore.current
  val store = app.teammates
  val router = LocalRouter.current
  val scope = rememberCoroutineScope()
  val summaries by store.teammates.collectAsState()
  val loaded by store.loaded.collectAsState()
  val error by store.error.collectAsState()
  var moving by remember { mutableStateOf(false) }
  var moveFailed by remember { mutableStateOf(false) }

  LaunchedEffect(Unit) { if (!store.loaded.value) store.refresh() }
  // A computer too old to answer `teammates.list` gets nothing here.
  if (!loaded || (error != null && summaries.isEmpty() && !moveFailed)) return

  val teammates = summaries.map { it.teammate }
  val owner = automation.teammateId?.let { id -> teammates.firstOrNull { it.id == id } }
  if (automation.teammateId != null) {
    ListSection(header = "Teammate") {
      ListRow(
        owner?.name ?: "Teammate",
        subtitle = owner?.let { "One of ${TeammateText.handle(it.handle)}'s duties" },
        onClick = { router.push(Route.TeammateDuties(automation.teammateId!!, owner?.name ?: "Teammate")) },
        leading = owner?.let { { TeammateAvatar(it.name, it.color, it.avatar) } },
      )
    }
    return
  }
  if (!hasControl) return

  if (moveFailed) {
    error?.let { Banner(it, tone = Tone.Danger, onDismiss = { moveFailed = false; store.clearError() }) }
  }
  MoveToTeammateMenu(teammates, enabled = ready && !moving) { teammateId ->
    moving = true
    moveFailed = false
    scope.launch {
      val teammate = store.promote(automation.id, teammateId)
      if (teammate != null) app.automations.refresh() else moveFailed = true
      moving = false
    }
  }
}

/** "New teammate" names one after the automation; an existing one takes it as a duty. */
@Composable
private fun MoveToTeammateMenu(teammates: List<Teammate>, enabled: Boolean, move: (teammateId: String?) -> Unit) {
  var open by remember { mutableStateOf(false) }
  Box {
    Btn("Move to teammate", tone = ButtonTone.Secondary, small = true, hugs = true, icon = Icon.person, enabled = enabled) { open = true }
    DropdownMenu(open, { open = false }, containerColor = ArgusTheme.colors.surface) {
      DropdownMenuItem(
        text = { Text("New teammate") },
        leadingIcon = { Icon(Icon.plus, null) },
        onClick = {
          open = false
          move(null)
        },
      )
      if (teammates.isNotEmpty()) HorizontalDivider()
      for (teammate in teammates) {
        DropdownMenuItem(
          text = { Text(teammate.name) },
          leadingIcon = { TeammateAvatar(teammate.name, teammate.color, teammate.avatar, size = 24.dp) },
          onClick = {
            open = false
            move(teammate.id)
          },
        )
      }
    }
  }
}
