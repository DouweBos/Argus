package dev.houwert.argus.app.screens.teammates

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.app.screens.AppScreen
import dev.houwert.argus.app.screens.automations.rememberHostAccess
import dev.houwert.argus.core.stores.createFromTemplate
import dev.houwert.argus.core.stores.integrations
import dev.houwert.argus.core.stores.isConnected
import dev.houwert.argus.core.stores.loadIntegrations
import dev.houwert.argus.core.stores.loadTemplates
import dev.houwert.argus.kit.protocol.generated.IntegrationId
import dev.houwert.argus.kit.protocol.generated.IntegrationStatus
import dev.houwert.argus.kit.protocol.generated.RemoteTeammateTemplate
import dev.houwert.argus.kit.protocol.generated.RemoteTeammateTemplateRequiresItem
import dev.houwert.argus.ui.automations.AutomationFieldsText
import dev.houwert.argus.ui.automations.FormSheet
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.Field
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.ToggleList
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.teammates.TeammateTemplateCard
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.launch

/** Starting teammates to pick from. One is created paused, on the projects picked, and opens on its conversation. */
@Composable
fun TeammateGalleryScreen() {
  val app = LocalAppStore.current
  val store = app.teammates
  val access = rememberHostAccess()
  val templates by store.templates.collectAsState()
  val error by store.error.collectAsState()
  val integrations by app.host.integrations.collectAsState()
  var picked by remember { mutableStateOf<RemoteTeammateTemplate?>(null) }

  LaunchedEffect(Unit) {
    store.loadTemplates()
    app.host.loadIntegrations()
  }

  AppScreen("New Teammate") {
    Screen {
      error?.let { Banner(it, tone = Tone.Danger, onDismiss = store::clearError) }
      val list = templates
      when {
        list == null -> Loading("Reading templates")
        list.isEmpty() -> EmptyState(Icon.person, "No templates", body = "This computer offered no starting teammates.")
        else -> {
          MutedText("Each one starts paused, with its duties ready. Talk to it any time.")
          for (template in list) {
            TeammateTemplateCard(
              template, missing(template, integrations),
              onClick = if (access.hasControl) ({ picked = template }) else null,
            )
          }
        }
      }
    }
  }

  picked?.let { template ->
    CreateSheet(template, missing(template, integrations)) { picked = null }
  }
}

/** Picks the projects the new teammate works on, then creates it. */
@Composable
private fun CreateSheet(template: RemoteTeammateTemplate, missing: List<String>, onDismiss: () -> Unit) {
  val app = LocalAppStore.current
  val store = app.teammates
  val router = LocalRouter.current
  val access = rememberHostAccess()
  val scope = rememberCoroutineScope()
  val projects by app.host.projects.collectAsState()
  val error by store.error.collectAsState()
  var repoRoots by remember { mutableStateOf(emptyList<String>()) }
  var creating by remember { mutableStateOf(false) }

  FormSheet(
    template.name, onDismiss,
    confirmLabel = if (creating) "Creating" else "Create",
    confirmEnabled = !creating && repoRoots.isNotEmpty() && access.ready,
    onConfirm = {
      creating = true
      scope.launch {
        val teammate = store.createFromTemplate(template.id, repoRoots)
        creating = false
        if (teammate != null) {
          onDismiss()
          // Back from the new teammate lands on the list, not the gallery.
          router.replaceTop(Route.Teammate(teammate.id, teammate.name), 1)
        }
      }
    },
  ) {
    error?.let { Banner(it, tone = Tone.Danger) }
    TeammateTemplateCard(template, missing)
    if (missing.isNotEmpty()) MutedText("Connect ${missing.joinToString(" and ")} in Argus on the Mac for every duty to work.")
    Field("Scope", caption = "The repos it may read and work in. Change them later in its profile.") {
      ToggleList(
        AutomationFieldsText.projectOptions(projects, repoRoots), repoRoots, { repoRoots = it },
        title = "Projects", emptyMessage = "This computer has no projects registered.",
      )
    }
  }
}

/** What it needs that the computer hasn't connected. Git hosts aren't reported, so only what it can answer for is named. */
private fun missing(template: RemoteTeammateTemplate, integrations: List<IntegrationStatus>): List<String> =
  template.requires.mapNotNull { need ->
    when (need) {
      RemoteTeammateTemplateRequiresItem.linear -> if (integrations.isConnected(IntegrationId.linear)) null else "Linear"
      RemoteTeammateTemplateRequiresItem.slack -> "Slack"
      else -> null
    }
  }
