package dev.houwert.argus.app.screens.teammates

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.screens.AppScreen
import dev.houwert.argus.app.screens.automations.rememberHostAccess
import dev.houwert.argus.core.stores.deleteMemory
import dev.houwert.argus.core.stores.loadMemories
import dev.houwert.argus.core.stores.saveMemory
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationMemory
import dev.houwert.argus.ui.automations.MemoriesSection
import dev.houwert.argus.ui.automations.MemoryEditorSheet
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.theme.Tone

/** The one memory a teammate's duties and conversations share: read it, and with control edit it. */
@Composable
fun TeammateMemoryScreen(id: String, label: String) {
  val store = LocalAppStore.current.teammates
  val access = rememberHostAccess()
  val memoriesById by store.memoriesById.collectAsState()
  val detailById by store.detailById.collectAsState()
  val error by store.error.collectAsState()
  val name = detailById[id]?.teammate?.name ?: label
  // The memory sheet: open with null adds one.
  var sheet by remember { mutableStateOf(false) }
  var openMemory by remember { mutableStateOf<RemoteAutomationMemory?>(null) }

  LiveRefresh(enabled = access.ready) { store.loadMemories(id) }

  AppScreen("Memory") {
    Screen {
      error?.let { Banner(it, tone = Tone.Danger, onDismiss = store::clearError) }
      val items = memoriesById[id]
      if (items == null) {
        Loading("Reading memories")
      } else {
        MutedText("Everything $name does reads this index, and saves what it learns here.")
        MemoriesSection(
          items, access.hasControl,
          emptyMessage = "Nothing yet. Its duties and conversations save what they learn here.",
          showsHeader = items.isNotEmpty(),
        ) { memory ->
          openMemory = memory
          sheet = true
        }
      }
    }
  }

  if (sheet) {
    MemoryEditorSheet(
      openMemory, access.hasControl, error,
      save = { draft, previous -> store.saveMemory(id, draft, previous) },
      delete = { memoryName -> store.deleteMemory(id, memoryName) },
      onDismiss = { sheet = false },
    )
  }
}
