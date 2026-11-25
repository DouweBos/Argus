package dev.houwert.argus.app.screens.newproject

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
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.projects.CloneRepositoryModel
import dev.houwert.argus.core.stores.refreshProjects
import dev.houwert.argus.kit.protocol.generated.CloneJob
import dev.houwert.argus.kit.protocol.generated.CloneSource
import dev.houwert.argus.kit.protocol.generated.CloneStatus
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.CloneProgressCard
import dev.houwert.argus.ui.components.Field
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.components.TopBarScreen
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * `/projects/clone`: clone a repository into a new project on the computer. The folder is a path on
 * the computer, so it offers the remembered one and where the other projects live, not a file picker.
 */
@Composable
fun CloneRepositoryScreen(initialUrl: String = "", initialCloneId: String? = null) {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val host = app.host
  val model = remember { CloneRepositoryModel(host, initialCloneId).also { it.url.value = initialUrl } }
  val capabilities by host.capabilities.collectAsState()
  val clones by host.clones.collectAsState()
  val cloneId by model.cloneId.collectAsState()
  val starting by model.starting.collectAsState()
  val preview by model.preview.collectAsState()
  val url by model.url.collectAsState()
  val hasControl = "control" in capabilities
  val job = model.job(clones)
  val scope = rememberCoroutineScope()

  LaunchedEffect(Unit) { model.load() }
  LaunchedEffect(cloneId, job?.status) { if (job?.status == CloneStatus.running) model.watch() }
  // Swaps this screen for the project, so back skips a finished flow.
  fun open(job: CloneJob) {
    if (router.frontRoute != Route.CloneRepository) return
    router.replaceTop(Route.Project(job.path, job.path.trimEnd('/').substringAfterLast('/')), 1)
  }
  LaunchedEffect(job?.status) {
    if (job?.status == CloneStatus.done) {
      host.refreshProjects()
      open(job)
    }
  }

  TopBarScreen(
    "Clone Repository", onBack = router::pop,
    actions = {
      if (job == null && hasControl) {
        val canStart = !starting && url.isNotBlank() && preview?.problem == null && preview != null
        Btn(if (starting) "Cloning" else "Clone", Modifier.padding(end = 8.dp), small = true, hugs = true, enabled = canStart) {
          scope.launch { model.start(CloneSource.android) }
        }
      }
    },
  ) {
    if (job != null) {
      Screen {
        CloneProgressCard(job)
        when (job.status) {
          CloneStatus.running ->
            Btn("Cancel", tone = ButtonTone.Secondary, small = true, icon = Icon.close, hugs = true, enabled = hasControl) {
              scope.launch { model.cancel() }
            }
          CloneStatus.failed, CloneStatus.cancelled ->
            Btn("Try Again", tone = ButtonTone.Secondary, small = true, icon = Icon.refresh, hugs = true) { model.retry() }
          else -> Btn("Open Project", small = true, hugs = true) { open(job) }
        }
      }
      return@TopBarScreen
    }
    CloneForm(model, hasControl)
  }
}

@Composable
private fun CloneForm(model: CloneRepositoryModel, hasControl: Boolean) {
  val theme = ArgusTheme.colors
  val url by model.url.collectAsState()
  val parentDir by model.parentDir.collectAsState()
  val name by model.name.collectAsState()
  val preview by model.preview.collectAsState()
  val defaults by model.defaults.collectAsState()
  val error by model.error.collectAsState()

  LaunchedEffect(url, parentDir, name) {
    delay(250)
    model.refreshPreview()
  }

  Screen {
    error?.let { Banner(it, tone = Tone.Danger) }
    val shorthand = if (defaults?.ghAvailable == true) "owner/repo clones with gh" else "owner/repo clones from GitHub"
    Field("Repository", caption = "An https URL, an ssh address like git@github.com:owner/repo.git, or owner/repo — $shorthand.") {
      ThemedTextField(url, { model.url.value = it }, "https://github.com/owner/repo", mono = true, input = TextInput.Code, enabled = hasControl)
    }
    Field("Folder on the computer") {
      Card {
        model.parentChoices().forEachIndexed { index, folder ->
          if (index > 0) HorizontalDivider(color = theme.borderSubtle)
          Row(
            Modifier.fillMaxWidth().argusClickable(rememberInteraction(), enabled = hasControl, label = folder) { model.parentDir.value = folder }
              .padding(vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
          ) {
            Icon(Icon.folder, null, Modifier.size(18.dp), tint = theme.textSecondary)
            Text(folder, Modifier.weight(1f), color = theme.text, style = argusFont(14, mono = true), maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (folder == parentDir) Icon(Icon.check, "Selected", Modifier.size(18.dp), tint = theme.accent)
          }
        }
      }
      ThemedTextField(parentDir, { model.parentDir.value = it }, "/Users/you/Developer", mono = true, input = TextInput.Code, enabled = hasControl)
    }
    val problem = preview?.problem
    val caption = if (problem == null) preview?.path?.takeIf { it.isNotEmpty() }?.let { "Clones into $it and adds it as a project." } else null
    Field("Folder name", caption = caption) {
      ThemedTextField(name, { model.name.value = it }, preview?.name?.ifEmpty { null } ?: "repo", mono = true, input = TextInput.Code, enabled = hasControl)
      problem?.let { Text(it, color = theme.error, style = argusFont(13)) }
    }
  }
}
