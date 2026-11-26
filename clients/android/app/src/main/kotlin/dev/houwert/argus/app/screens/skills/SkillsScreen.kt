package dev.houwert.argus.app.screens.skills

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.app.screens.inbox.TopBarScaffold
import dev.houwert.argus.core.skills.SkillsModel
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.Skill
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ConfirmDialog
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.LoadPhaseBox
import dev.houwert.argus.ui.components.MenuAction
import dev.houwert.argus.ui.components.OverflowMenu
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.icons.Icon as ArgusIcon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.launch

/**
 * `/skills`: the skills the runners load on the computer, yours then each project's. Installing,
 * updating and removing need control; a folder or a `.skill` file installs from the Mac.
 */
@Composable
fun SkillsScreen() {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val host = app.host
  val model = remember(host) { SkillsModel(host) }
  val scope = rememberCoroutineScope()
  val connection by host.connection.collectAsState()
  val capabilities by host.capabilities.collectAsState()
  val hasControl = "control" in capabilities
  val skills by model.skills.collectAsState()
  val loaded by model.loaded.collectAsState()
  val error by model.error.collectAsState()
  val notice by model.notice.collectAsState()
  val busy by model.busy.collectAsState()
  var removing by remember { mutableStateOf<Skill?>(null) }

  LiveRefresh(enabled = connection == Transport.State.Ready) { model.refresh() }

  TopBarScaffold(
    "Skills", onRefresh = { model.refresh() },
    actions = { if (hasControl) IconBtn(ArgusIcon.plus, "Install skill", tint = ArgusTheme.colors.accent) { router.push(Route.InstallSkill()) } },
  ) {
    LoadPhaseBox(
      loaded, error, skills.isEmpty(), Modifier.fillMaxSize(),
      loadingLabel = "Reading skills", failedTitle = "Skills unavailable", onRetry = { scope.launch { model.refresh() } },
      empty = {
        EmptyState(
          ArgusIcon.skills, "No skills yet",
          body = "A skill is a folder with a SKILL.md that Claude Code or Codex loads when a task calls for it.",
        ) {
          if (hasControl) Btn("Install skill", icon = ArgusIcon.plus, hugs = true) { router.push(Route.InstallSkill()) }
        }
      },
    ) {
      Screen {
        error?.let { Banner(it, tone = Tone.Danger) }
          ?: notice?.let { Banner(it, tone = Tone.Success, onDismiss = model::dismissNotice) }
        model.sections(skills).forEach { section ->
          ListSection(header = section.title) {
            section.skills.forEach { skill ->
              SkillRow(
                skill, busy = skill.path in busy,
                actions = if (!hasControl) emptyList() else listOfNotNull(
                  if (SkillsModel.canUpdate(skill)) MenuAction("Update", ArgusIcon.refresh) { scope.launch { model.update(skill) } } else null,
                  MenuAction("Remove", ArgusIcon.trash, destructive = true) { removing = skill },
                ),
              )
            }
          }
        }
      }
    }
  }

  removing?.let { skill ->
    ConfirmDialog(
      "Remove ${skill.name}?", "Remove",
      onConfirm = { scope.launch { model.remove(skill) } }, onDismiss = { removing = null },
      message = "Deletes its folder on the computer. ${SkillsModel.runnerLabel(skill.runner)} stops loading it.",
      destructive = true,
    )
  }
}

@Composable
private fun SkillRow(skill: Skill, busy: Boolean, actions: List<MenuAction>) {
  val theme = ArgusTheme.colors
  Row(
    Modifier.fillMaxWidth().heightIn(min = ArgusMetrics.minTouchTarget)
      .padding(start = 16.dp, end = if (actions.isEmpty()) 16.dp else 4.dp, top = 10.dp, bottom = 10.dp),
    horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
  ) {
    Box(Modifier.size(30.dp).background(theme.accent.copy(alpha = 0.12f), RoundedCornerShape(7.dp)), contentAlignment = Alignment.Center) {
      Icon(ArgusIcon.skills, null, Modifier.size(18.dp), tint = theme.accent)
    }
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(skill.name, color = theme.text, style = ArgusTheme.typography.body, maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(SkillsModel.detail(skill), color = theme.textSecondary, style = ArgusTheme.typography.footnote, maxLines = 2, overflow = TextOverflow.Ellipsis)
      val meta = listOfNotNull(SkillsModel.runnerLabel(skill.runner), SkillsModel.sourceLabel(skill.source)).joinToString(" · ")
      Text(meta, color = theme.textMuted, style = ArgusTheme.typography.caption, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    when {
      busy -> CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = theme.accent)
      actions.isNotEmpty() -> OverflowMenu("Actions for ${skill.name}", actions)
    }
  }
}
