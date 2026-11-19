package dev.houwert.argus.ui.gallery

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.components.AgentRow
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.ChangeCounts
import dev.houwert.argus.ui.components.ListRow
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.components.ProjectBadge
import dev.houwert.argus.ui.components.SectionHeader
import dev.houwert.argus.ui.components.ToggleList
import dev.houwert.argus.ui.components.ToggleOption
import dev.houwert.argus.ui.icons.FileTypeIcon
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.Tone

internal val galleryProjects =
  listOf(
    "Argus", "website", "mobile-app", "infra", "design-tokens", "docs", "payments-api", "search", "analytics",
    "react-native-client", "cli", "playground",
  )

@Composable
internal fun ListsPage() {
  Story("List sections") {
    ListSection(header = "Projects", footer = "Projects live on the computer; every device sees the same list.", dividerInset = 52.dp) {
      galleryProjects.take(6).forEachIndexed { i, name ->
        ListRow(
          name,
          subtitle = "${(i * 3 + 2)} sessions · updated ${i + 1}h ago",
          leading = { ProjectBadge(name, key = "/r/$name", size = 24.dp) },
          onClick = {},
        )
      }
    }
  }
  Story("Agents") {
    ListSection {
      AgentRow("Unify the start composer", Tone.Accent, Modifier.padding(16.dp, 11.dp), running = true, meta = "Argus", model = "Opus", project = "Argus", projectKey = "/r/Argus")
      AgentRow("Fix the flaky merge test", Tone.Warning, Modifier.padding(16.dp, 11.dp), attention = "Permission", model = "Sonnet")
      AgentRow("Audit dependencies", Tone.Danger, Modifier.padding(16.dp, 11.dp), meta = "Failed 2m ago")
      AgentRow("Write release notes", Tone.Success, Modifier.padding(16.dp, 11.dp), meta = "Stopped")
      AgentRow("Idle helper", Tone.Muted, Modifier.padding(16.dp, 11.dp))
    }
  }
  Story("Rows") {
    ListSection(header = "Changes", dividerInset = 52.dp) {
      for ((path, add, del) in listOf(Triple("packages/host/src/boot.ts", 42, 7), Triple("clients/android/ui/build.gradle.kts", 3, 0), Triple("README.md", 0, 12))) {
        ListRow(path.substringAfterLast('/'), subtitle = path.substringBeforeLast('/'), leading = { FileTypeIcon(path, size = 24.dp) }, onClick = {}) {
          ChangeCounts(add, del)
        }
      }
      ListRow("src", leading = { FileTypeIcon("src", isDirectory = true, size = 24.dp) }, value = "14 files", onClick = {})
    }
    ListSection {
      ListRow("Branch", icon = Icon.branch, value = "main", onClick = {})
      ListRow("Pull request", icon = Icon.pullRequest, onClick = {}) { Badge("Open", tone = Tone.Success) }
      ListRow("Delete session", icon = Icon.trash, tone = Tone.Danger, onClick = {}, chevron = false)
      ListRow("Read only", subtitle = "No action", icon = Icon.lock)
    }
  }
  Story("Toggle list") {
    var picked by remember { mutableStateOf(listOf("Argus", "docs")) }
    ToggleList(
      galleryProjects.take(5).map { ToggleOption(it, it, hint = if (it == "infra") "not configured" else null, icon = Icon.folder) },
      picked, { picked = it }, title = "Projects",
    )
  }
  SectionHeader("End", count = galleryProjects.size)
  Box(Modifier.height(24.dp))
}
