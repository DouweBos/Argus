package dev.houwert.argus.app.screens.skills

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.core.skills.SkillInstallModel
import dev.houwert.argus.core.skills.SkillsModel
import dev.houwert.argus.core.stores.refreshProjects
import dev.houwert.argus.kit.protocol.generated.SkillRunner
import dev.houwert.argus.kit.protocol.generated.SkillScope
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.Field
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.SegmentedControl
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.components.TopBarScreen
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon as ArgusIcon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

/**
 * `/skills/install`: install a skill from a git URL or a gist onto the computer. A folder or a
 * `.skill` file is a path on the computer, so those install from the Mac. Needs control.
 */
@Composable
fun SkillInstallScreen(url: String? = null) {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val host = app.host
  val model = remember(host) { SkillInstallModel(SkillsModel(host), url) }
  val scope = rememberCoroutineScope()
  val capabilities by host.capabilities.collectAsState()
  val hasControl = "control" in capabilities
  val projects by host.projects.collectAsState()
  val location by model.location.collectAsState()
  val subpath by model.subpath.collectAsState()
  val target by model.scope.collectAsState()
  val runner by model.runner.collectAsState()
  val repoRoot by model.repoRoot.collectAsState()
  val installing by model.installing.collectAsState()
  val conflict by model.conflict.collectAsState()
  val error by model.error.collectAsState()
  val theme = ArgusTheme.colors

  LaunchedEffect(Unit) { if (projects.isEmpty()) host.refreshProjects() }

  TopBarScreen(
    "Install Skill", onBack = router::pop,
    actions = {
      if (hasControl) {
        val label = when {
          installing -> "Installing"
          conflict != null -> "Replace"
          else -> "Install"
        }
        Btn(label, Modifier.padding(end = 8.dp), small = true, hugs = true, enabled = model.canInstall) {
          scope.launch { if (model.install() != null) router.pop() }
        }
      }
    },
  ) {
    Screen {
      when {
        conflict != null -> Banner("A skill named $conflict is already installed there. Replace deletes its files first.", tone = Tone.Warning)
        else -> error?.let { Banner(it, tone = Tone.Danger) }
      }
      fun edit(change: () -> Unit) {
        change()
        model.edited()
      }
      Field("From", caption = SkillInstallModel.URL_HINT + " A folder or a .skill file installs from the Mac.") {
        ThemedTextField(location, { edit { model.location.value = it } }, "https://github.com/owner/skills", mono = true, input = TextInput.Code, enabled = hasControl)
        ThemedTextField(subpath, { edit { model.subpath.value = it } }, "Folder inside the repository, optional", mono = true, input = TextInput.Code, enabled = hasControl)
      }
      val projectName = projects.firstOrNull { it.repoRoot == repoRoot }?.name
      Field("Install into", caption = model.destinationHint(projectName)) {
        SegmentedControl(target, listOf(SkillScope.user to "Every project", SkillScope.project to "One project")) {
          edit { model.scope.value = it }
        }
        if (target == SkillScope.project) {
          Card {
            projects.forEachIndexed { index, project ->
              if (index > 0) HorizontalDivider(color = theme.borderSubtle)
              Row(
                Modifier.fillMaxWidth()
                  .argusClickable(rememberInteraction(), enabled = hasControl, label = project.name) { edit { model.repoRoot.value = project.repoRoot } }
                  .padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
              ) {
                Icon(ArgusIcon.folder, null, Modifier.size(18.dp), tint = theme.textSecondary)
                Text(project.name, Modifier.weight(1f), color = theme.text, style = argusFont(15), maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (project.repoRoot == repoRoot) Icon(ArgusIcon.check, "Selected", Modifier.size(18.dp), tint = theme.accent)
              }
            }
          }
        }
        SegmentedControl(runner, listOf(SkillRunner.claudeCode to SkillsModel.runnerLabel(SkillRunner.claudeCode), SkillRunner.codex to SkillsModel.runnerLabel(SkillRunner.codex))) {
          edit { model.runner.value = it }
        }
      }
    }
  }
}
